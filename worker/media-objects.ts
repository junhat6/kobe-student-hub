// Private R2 storage for normalized media bytes (#12, expand stage).
//
// D1 stays the only authority: every read is authorized by a D1 query first, and the object key is
// derived from the D1 row (id + sha256). The bucket has no public access (no r2.dev, no custom
// domain), so a key is never a capability on its own.
//
// Contract stage (#12, after 0045 and a full audit match in production): with a bucket, new bytes go
// to R2 only and the D1 row keeps the size, sha256 and object_stored_at_ms with payload NULL. Without
// a bucket (local preview, older config) bytes stay in D1. Reads prefer R2 and fall back to the D1
// payload, which older rows hold until the cron has verified their object and erased it. A rollback to the previous
// Worker keeps working because it also reads R2 first. object_stored_at_ms records a past copy, not
// that the object still exists; the audit (head/get and sha256 against the row) watches that.
import { MEDIA_MAX_BYTES } from '../src/shared/media';

type MediaBindings = { MEDIA_BUCKET?: R2Bucket };
export type MediaObjectRef = { id: string; sha256: string; bytes: number };

const HEX64 = /^[0-9a-f]{64}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** sha256 is part of the key: a colliding upload with another id/bytes never overwrites a stored object. */
const mediaObjectKey = (id: string, sha256: string) => `media/${id}/${sha256}`;
const parseKey = (key: string) => {
  const m = /^media\/([0-9a-f-]{36})\/([0-9a-f]{64})$/.exec(key);
  return m && ID.test(m[1]) ? { id: m[1], sha256: m[2] } : null;
};
export const mediaBucket = (env: unknown): R2Bucket | undefined => {
  const b = (env as MediaBindings | undefined)?.MEDIA_BUCKET;
  return b && typeof b.get === 'function' && typeof b.put === 'function' ? b : undefined;
};

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * Throws when R2 refuses the write or records another size than the normalized bytes; callers must
 * not create the D1 row in that case (and remove a stored object). The D1 row carries no payload
 * (#12 contract), so the object R2 reports is the only copy and must match the row's size exactly.
 */
export async function putMediaObject(
  bucket: R2Bucket,
  ref: { id: string; sha256: string },
  bytes: Uint8Array,
  mime: string,
): Promise<void> {
  if (!ID.test(ref.id) || !HEX64.test(ref.sha256)) throw Error('invalid media object');
  const object = await bucket.put(mediaObjectKey(ref.id, ref.sha256), bytes, {
    httpMetadata: { contentType: mime },
    // R2 rejects the write if the bytes do not match, so a truncated body never becomes an object.
    sha256: ref.sha256,
  });
  if (!object || object.size !== bytes.length) throw Error('media object size mismatch');
}

/** Bytes from R2 only when they match the authorized D1 row exactly; otherwise null (caller falls back). */
export async function getMediaObject(
  bucket: R2Bucket | undefined,
  ref: MediaObjectRef,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!bucket || !ID.test(ref.id) || !HEX64.test(ref.sha256)) return null;
  if (!Number.isInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > MEDIA_MAX_BYTES) return null;
  try {
    const object = await bucket.get(mediaObjectKey(ref.id, ref.sha256));
    if (!object || object.size !== ref.bytes) {
      void object?.body.cancel().catch(() => {});
      return null;
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    return bytes.length === ref.bytes && (await sha256Hex(bytes)) === ref.sha256 ? bytes : null;
  } catch {
    return null;
  }
}

/** Best effort. A failure leaves an orphan object that sweepMediaObjects removes later. */
export async function deleteMediaObjects(
  bucket: R2Bucket | undefined,
  refs: readonly { id: string; sha256: string }[],
): Promise<void> {
  const keys = refs
    .filter((r) => ID.test(r.id) && HEX64.test(r.sha256))
    .map((r) => mediaObjectKey(r.id, r.sha256));
  if (!bucket || !keys.length) return;
  try {
    await bucket.delete(keys.slice(0, 1000));
  } catch {
    // Swept later.
  }
}

const ORPHAN_GRACE_MS = 60 * 60 * 1000;
const SWEEP_LIMIT = 100;
const BACKFILL_LIMIT = 8;
const ERASE_LIMIT = 8;

/**
 * Scheduled maintenance, bounded per run:
 *  1. copy D1-only rows (written by the previous Worker or before the bucket existed) to R2;
 *  2. drop the D1 payload of copied rows (#12 contract, migration 0050) once the R2 object was read
 *     back and equals that payload byte for byte and the row's size and sha256;
 *  3. delete objects whose D1 row (id + sha256) is gone, after a grace period that covers the
 *     put-then-insert window of an upload in flight.
 * Both start at a random id so every row and object is eventually visited without stored state.
 */
export async function maintainMediaObjects(
  db: D1Database,
  bucket: R2Bucket | undefined,
  clock: () => number = Date.now,
  start: string = crypto.randomUUID(),
): Promise<{ copied: number; erased: number; swept: number }> {
  const result = { copied: 0, erased: 0, swept: 0 };
  if (!bucket) return result;
  const from = ID.test(start) ? start : '';
  try {
    // Start at the same random id as the sweep and wrap around once. A fixed order (oldest first)
    // would let rows that can never be copied (payload not matching its sha256) fill every batch
    // and stop the backfill for good; a random start reaches every pending row eventually.
    type Pending = { id: string; mime: string; sha256: string; payload: number[] };
    const pending = (where: string, limit: number) =>
      db
        .prepare(
          `SELECT id,mime,sha256,payload FROM media_assets WHERE object_stored_at_ms IS NULL AND ${where} ORDER BY id LIMIT ?`,
        )
        .bind(from, limit)
        .all<Pending>();
    const rows = (await pending('id>?', BACKFILL_LIMIT)).results;
    if (rows.length < BACKFILL_LIMIT && from)
      rows.push(...(await pending('id<=?', BACKFILL_LIMIT - rows.length)).results);
    for (const row of rows) {
      if (
        !Array.isArray(row.payload) ||
        !row.payload.length ||
        row.payload.length > MEDIA_MAX_BYTES ||
        row.payload.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
      )
        continue;
      const bytes = Uint8Array.from(row.payload);
      if ((await sha256Hex(bytes)) !== row.sha256) continue;
      try {
        await putMediaObject(bucket, row, bytes, row.mime);
      } catch {
        continue;
      }
      const now = clock();
      const updated = await db
        .prepare(
          'UPDATE media_assets SET object_stored_at_ms=? WHERE id=? AND sha256=? AND object_stored_at_ms IS NULL',
        )
        .bind(now, row.id, row.sha256)
        .run();
      if (updated.meta.changes === 1) result.copied++;
    }
  } catch {
    // Retried on the next run.
  }
  try {
    result.erased = await eraseCopiedPayloads(db, bucket, from);
  } catch {
    // Retried on the next run.
  }
  try {
    const startAfter = from ? `media/${from}` : 'media/';
    let listed = await bucket.list({ prefix: 'media/', startAfter, limit: SWEEP_LIMIT });
    // Wrap around once so a random start near the end still visits a full page.
    // The head page can repeat keys already listed when the bucket holds fewer objects than a page.
    if (listed.objects.length < SWEEP_LIMIT && startAfter !== 'media/') {
      const head = await bucket.list({
        prefix: 'media/',
        limit: SWEEP_LIMIT - listed.objects.length,
      });
      const seen = new Set(listed.objects.map((o) => o.key));
      listed = {
        ...listed,
        objects: [...listed.objects, ...head.objects.filter((o) => !seen.has(o.key))],
      };
    }
    const cutoff = clock() - ORPHAN_GRACE_MS;
    const candidates = listed.objects
      .filter((o) => o.uploaded.getTime() < cutoff)
      .map((o) => ({ key: o.key, ref: parseKey(o.key) }));
    const stale = candidates.filter((c) => !c.ref).map((c) => c.key);
    const refs = candidates.flatMap((c) => (c.ref ? [c.ref] : []));
    const live = new Set<string>();
    for (let i = 0; i < refs.length; i += 50) {
      const chunk = refs.slice(i, i + 50);
      const found = await db
        .prepare(
          `SELECT id,sha256 FROM media_assets WHERE id IN (${chunk.map(() => '?').join(',')})`,
        )
        .bind(...chunk.map((r) => r.id))
        .all<{ id: string; sha256: string }>();
      for (const r of found.results) live.add(mediaObjectKey(r.id, r.sha256));
    }
    const orphans = [
      ...stale,
      ...refs.map((r) => mediaObjectKey(r.id, r.sha256)).filter((k) => !live.has(k)),
    ];
    if (orphans.length) {
      await bucket.delete(orphans);
      result.swept = orphans.length;
    }
  } catch {
    // Retried on the next run.
  }
  return result;
}

/**
 * Contract step of #12: a row keeps its payload until the R2 object is proven to hold the same
 * bytes. Each row is read back from R2 (size and sha256 against the row, see getMediaObject) and
 * compared with its payload byte for byte; only then one guarded UPDATE drops the payload. The
 * WHERE repeats every condition of media_assets_content_immutable (0050), so a row that changed in
 * between is skipped (0 changes) instead of failing the statement. An R2 miss or mismatch keeps
 * the payload, which the reads still fall back to; the audit reports such rows. Returns the count.
 */
async function eraseCopiedPayloads(
  db: D1Database,
  bucket: R2Bucket,
  from: string,
): Promise<number> {
  const candidates = (where: string, limit: number) =>
    db
      .prepare(
        `SELECT id,sha256,bytes FROM media_assets WHERE payload IS NOT NULL AND object_stored_at_ms IS NOT NULL AND bytes IS length(payload) AND ${where} ORDER BY id LIMIT ?`,
      )
      .bind(from, limit)
      .all<MediaObjectRef>();
  const rows = (await candidates('id>?', ERASE_LIMIT)).results;
  if (rows.length < ERASE_LIMIT && from)
    rows.push(...(await candidates('id<=?', ERASE_LIMIT - rows.length)).results);
  let erased = 0;
  for (const row of rows) {
    // One row that fails (D1 hiccup, a trigger refusing it) does not stop the others.
    try {
      if (await eraseOne(db, bucket, row)) erased++;
    } catch {
      // Kept; retried on a later run.
    }
  }
  return erased;
}

async function eraseOne(db: D1Database, bucket: R2Bucket, row: MediaObjectRef): Promise<boolean> {
  const stored = await getMediaObject(bucket, row);
  if (!stored) return false;
  const held = await db
    .prepare('SELECT payload FROM media_assets WHERE id=? AND sha256=? AND payload IS NOT NULL')
    .bind(row.id, row.sha256)
    .first<{ payload: number[] }>();
  const payload = held?.payload;
  if (
    !Array.isArray(payload) ||
    payload.length !== stored.length ||
    payload.some((n, i) => n !== stored[i])
  )
    return false;
  const updated = await db
    .prepare(
      'UPDATE media_assets SET payload=NULL WHERE id=? AND sha256=? AND bytes=? AND payload IS NOT NULL AND object_stored_at_ms IS NOT NULL AND bytes IS length(payload)',
    )
    .bind(row.id, row.sha256, row.bytes)
    .run();
  return updated.meta.changes === 1;
}

type MediaObjectAudit = {
  /** Every media row in D1. */
  total: number;
  /** Rows whose bytes are still only in D1 (object_stored_at_ms IS NULL). */
  pending: number;
  /** Copied rows whose object was looked up in R2 this run. */
  checked: number;
  /** Copied rows with no object in R2. */
  missing: number;
  /** Copied rows whose object differs from the row in size or sha256. */
  mismatched: number;
  /** True when every copied row was checked (the run was not cut at AUDIT_LIMIT). */
  complete: boolean;
};

const AUDIT_LIMIT = 500;
const AUDIT_INTERVAL_MS = 55 * 60 * 1000;
const AUDITS_KEPT = 14;
const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b), (v) => v.toString(16).padStart(2, '0')).join('');

/**
 * Read-only reconciliation of D1 media rows against R2 (#249), the precondition for the contract
 * stage of #12. It only runs SELECT and R2 head/get, never put/delete or an UPDATE, and returns
 * counts only: no id, key, owner or bytes leave this function. R2 failures throw so the caller
 * records "could not audit" instead of a misleading zero.
 */
export async function auditMediaObjects(
  db: D1Database,
  bucket: R2Bucket,
  limit = AUDIT_LIMIT,
): Promise<MediaObjectAudit> {
  const counts = await db
    .prepare(
      'SELECT COUNT(*) total, COALESCE(SUM(object_stored_at_ms IS NULL),0) pending FROM media_assets',
    )
    .first<{ total: number; pending: number }>();
  const total = counts?.total ?? 0,
    pending = counts?.pending ?? 0;
  const rows = (
    await db
      .prepare(
        'SELECT id,sha256,COALESCE(bytes,length(payload)) bytes FROM media_assets WHERE object_stored_at_ms IS NOT NULL ORDER BY id LIMIT ?',
      )
      .bind(limit)
      .all<MediaObjectRef>()
  ).results;
  let missing = 0,
    mismatched = 0;
  for (const row of rows) {
    const key = mediaObjectKey(row.id, row.sha256);
    const head = await bucket.head(key);
    if (!head) {
      missing++;
      continue;
    }
    if (head.size !== row.bytes) {
      mismatched++;
      continue;
    }
    // putMediaObject stores the sha256 checksum; objects without one are hashed from their bytes.
    let digest = head.checksums?.sha256 ? hex(head.checksums.sha256) : '';
    if (!digest) {
      const object = await bucket.get(key);
      digest = object ? await sha256Hex(new Uint8Array(await object.arrayBuffer())) : '';
      if (!object) {
        missing++;
        continue;
      }
    }
    if (digest !== row.sha256) mismatched++;
  }
  return {
    total,
    pending,
    checked: rows.length,
    missing,
    mismatched,
    complete: rows.length === total - pending,
  };
}

/** Stores the counts of one audit and keeps only the latest AUDITS_KEPT rows. */
async function recordMediaAudit(
  db: D1Database,
  audit: MediaObjectAudit,
  now: number,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        'INSERT OR REPLACE INTO media_object_audits(measured_at_ms,total,pending,checked,missing,mismatched,complete) VALUES(?,?,?,?,?,?,?)',
      )
      .bind(
        now,
        audit.total,
        audit.pending,
        audit.checked,
        audit.missing,
        audit.mismatched,
        audit.complete ? 1 : 0,
      ),
    db
      .prepare(
        'DELETE FROM media_object_audits WHERE measured_at_ms NOT IN (SELECT measured_at_ms FROM media_object_audits ORDER BY measured_at_ms DESC LIMIT ?)',
      )
      .bind(AUDITS_KEPT),
  ]);
}

/** Scheduled entry: audits at most once per AUDIT_INTERVAL_MS. Failures are retried next run. */
export async function auditMediaObjectsIfDue(
  db: D1Database,
  bucket: R2Bucket | undefined,
  clock: () => number = Date.now,
): Promise<boolean> {
  if (!bucket) return false;
  try {
    const now = clock();
    const last = await db
      .prepare('SELECT MAX(measured_at_ms) at FROM media_object_audits')
      .first<{ at: number | null }>();
    if (last?.at != null && now - last.at < AUDIT_INTERVAL_MS) return false;
    await recordMediaAudit(db, await auditMediaObjects(db, bucket), now);
    return true;
  } catch {
    return false;
  }
}
