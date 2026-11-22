// Private R2 storage for normalized media bytes (#12, expand stage).
//
// D1 stays the only authority: every read is authorized by a D1 query first, and the object key is
// derived from the D1 row (id + sha256). The bucket has no public access (no r2.dev, no custom
// domain), so a key is never a capability on its own.
//
// Expand stage: new bytes go to R2 *and* D1 (payload). Reads prefer R2 and fall back to D1, so the
// previous Worker (D1 only) keeps working after a rollback. A later contract stage stops writing the
// payload once every row has object_stored_at_ms.
import { MEDIA_MAX_BYTES } from '../src/shared/media';

export type MediaBindings = { MEDIA_BUCKET?: R2Bucket };
export type MediaObjectRef = { id: string; sha256: string; bytes: number };

const HEX64 = /^[0-9a-f]{64}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** sha256 is part of the key: a colliding upload with another id/bytes never overwrites a stored object. */
export const mediaObjectKey = (id: string, sha256: string) => `media/${id}/${sha256}`;
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

/** Throws when R2 refuses the write; callers must not create the D1 row in that case. */
export async function putMediaObject(
  bucket: R2Bucket,
  ref: { id: string; sha256: string },
  bytes: Uint8Array,
  mime: string,
): Promise<void> {
  if (!ID.test(ref.id) || !HEX64.test(ref.sha256)) throw Error('invalid media object');
  await bucket.put(mediaObjectKey(ref.id, ref.sha256), bytes, {
    httpMetadata: { contentType: mime },
    // R2 rejects the write if the bytes do not match, so a truncated body never becomes an object.
    sha256: ref.sha256,
  });
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

/**
 * Scheduled maintenance, bounded per run:
 *  1. copy D1-only rows (written by the previous Worker or before the bucket existed) to R2;
 *  2. delete objects whose D1 row (id + sha256) is gone, after a grace period that covers the
 *     put-then-insert window of an upload in flight.
 * The sweep starts at a random position so every object is eventually visited without stored state.
 */
export async function maintainMediaObjects(
  db: D1Database,
  bucket: R2Bucket | undefined,
  clock: () => number = Date.now,
  start: string = crypto.randomUUID(),
): Promise<{ copied: number; swept: number }> {
  const result = { copied: 0, swept: 0 };
  if (!bucket) return result;
  try {
    const rows = await db
      .prepare(
        'SELECT id,mime,sha256,payload FROM media_assets WHERE object_stored_at_ms IS NULL ORDER BY created_at_ms,id LIMIT ?',
      )
      .bind(BACKFILL_LIMIT)
      .all<{ id: string; mime: string; sha256: string; payload: number[] }>();
    for (const row of rows.results) {
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
    const startAfter = ID.test(start) ? `media/${start}` : 'media/';
    let listed = await bucket.list({ prefix: 'media/', startAfter, limit: SWEEP_LIMIT });
    // Wrap around once so a random start near the end still visits a full page.
    if (listed.objects.length < SWEEP_LIMIT && startAfter !== 'media/') {
      const head = await bucket.list({
        prefix: 'media/',
        limit: SWEEP_LIMIT - listed.objects.length,
      });
      listed = { ...listed, objects: [...listed.objects, ...head.objects] };
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
