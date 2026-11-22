import { SessionStore } from './auth/sessions';
import { liveSessionSql as live, liveSessionBindings as binds } from './auth/session-guard';
import { ACTIVITY_DAYS } from './public-activity';
import type { PublicStudentActivity } from '../src/public-student-types';

const DAY_MS = 86400000;
const JAPAN_OFFSET_MS = 9 * 60 * 60 * 1000;
const isoDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/**
 * Owner-only layer of the grass: how many articles/works the signed-in student last viewed on
 * each Japan day, from their private reading history. Same window as the public grass. Only
 * counts leave the store (no ids or titles), only to the owner; deleting the history or turning
 * recording off removes or stops this layer, because nothing else is stored.
 */
export class OwnReadingActivityStore {
  private readonly sessions: SessionStore;
  constructor(
    private readonly db: D1Database,
    origin: string,
    clock: () => number = Date.now,
  ) {
    this.sessions = new SessionStore(db, origin, clock);
  }
  async readOwn(request: Request): Promise<PublicStudentActivity | null> {
    if (request.method !== 'GET') return null;
    try {
      const p = await this.sessions.storageAuthorization(request);
      if (!p || !Number.isSafeInteger(p.nowMs) || p.nowMs < 0) return null;
      const today = Math.floor((p.nowMs + JAPAN_OFFSET_MS) / DAY_MS);
      const first = today - ACTIVITY_DAYS + 1;
      const fromMs = first * DAY_MS - JAPAN_OFFSET_MS;
      // One statement: the live-session predicate gates every private row it returns.
      const rows = await this.db
        .prepare(
          `WITH authorized AS MATERIALIZED(SELECT 1 ok WHERE ${live}),
          grouped AS (SELECT (h.last_viewed_at_ms+${JAPAN_OFFSET_MS})/${DAY_MS} day,COUNT(*) n FROM private_reading_history h WHERE h.owner_account_id=? AND h.last_viewed_at_ms BETWEEN ? AND ? GROUP BY day ORDER BY day LIMIT ${ACTIVITY_DAYS + 1})
          SELECT g.day,g.n FROM authorized a LEFT JOIN grouped g ON 1=1 ORDER BY g.day`,
        )
        .bind(...binds(p), p.accountId, fromMs, p.nowMs)
        .all<{ day: number | null; n: number | null }>();
      if (!rows.results.length) return null;
      const days: PublicStudentActivity['days'] = [];
      for (const row of rows.results) {
        if (row.day === null) continue;
        if (!Number.isSafeInteger(row.day) || row.day < first || row.day > today) return null;
        if (!Number.isSafeInteger(row.n) || row.n! < 1) return null;
        days.push({ date: isoDay(row.day), count: Math.min(row.n!, 99) });
      }
      return { from: isoDay(first), to: isoDay(today), days };
    } catch {
      return null;
    }
  }
}
