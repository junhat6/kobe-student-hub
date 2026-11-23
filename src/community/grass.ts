import type { PublicStudentActivity } from '../public-student-types';

export interface GrassCell {
  date: string;
  count: number;
  /** Owner-only: items last viewed that day (private reading history). 0 on public pages. */
  read: number;
  /** 0 = nothing, 1..3 = one, two, three or more public events. */
  level: 0 | 1 | 2 | 3;
  /** Outside the window (padding before the first day or after today). */
  outside: boolean;
}
export interface Grass {
  /** Columns are Monday-first weeks, oldest first. */
  weeks: GrassCell[][];
  total: number;
  activeDays: number;
  /** Consecutive weeks with activity, ending this week (or last week while this one is still open). */
  streakWeeks: number;
  /** Longest run of consecutive active weeks anywhere in the window. */
  bestStreakWeeks: number;
  /** True when this week already has activity. */
  thisWeek: boolean;
  /** Owner-only total of the reading layer. */
  readTotal: number;
}
const DAY_MS = 86400000;
const dayNumber = (iso: string) => Date.parse(iso + 'T00:00:00Z') / DAY_MS;
const iso = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
/** Monday = 0 … Sunday = 6. 1970-01-01 (day 0) was a Thursday. */
const weekday = (day: number) => (((day + 3) % 7) + 7) % 7;

/**
 * Lays out the public activity as Monday-first weekly columns. Weekly (not daily) streaks:
 * students have exams and part-time jobs, and a daily streak would punish a missed day
 * instead of rewarding a returning one.
 */
export function buildGrass(
  activity: PublicStudentActivity,
  reading?: PublicStudentActivity | null,
): Grass {
  const counts = new Map(activity.days.map((d) => [d.date, d.count]));
  // The reading layer only shades one's own grass; streaks stay about publishing.
  const reads = new Map(
    reading && reading.to === activity.to ? reading.days.map((d) => [d.date, d.count]) : [],
  );
  const first = dayNumber(activity.from);
  const today = dayNumber(activity.to);
  const start = first - weekday(first);
  const end = today + (6 - weekday(today));
  const weeks: GrassCell[][] = [];
  for (let day = start; day <= end; day += 7) {
    const week: GrassCell[] = [];
    for (let offset = 0; offset < 7; offset++) {
      const d = day + offset;
      const inside = d >= first && d <= today;
      const count = inside ? (counts.get(iso(d)) ?? 0) : 0;
      const read = inside ? (reads.get(iso(d)) ?? 0) : 0;
      const shade = count + read;
      week.push({
        date: iso(d),
        count,
        read,
        level: shade === 0 ? 0 : shade === 1 ? 1 : shade === 2 ? 2 : 3,
        outside: d < first || d > today,
      });
    }
    weeks.push(week);
  }
  const active = weeks.map((week) => week.some((cell) => cell.count > 0));
  const thisWeek = active[active.length - 1] ?? false;
  let streakWeeks = 0;
  for (let i = active.length - (thisWeek ? 1 : 2); i >= 0 && active[i]; i--) streakWeeks++;
  let bestStreakWeeks = 0;
  let run = 0;
  for (const on of active) bestStreakWeeks = Math.max(bestStreakWeeks, (run = on ? run + 1 : 0));
  return {
    weeks,
    total: activity.days.reduce((sum, d) => sum + d.count, 0),
    activeDays: activity.days.length,
    streakWeeks,
    bestStreakWeeks,
    thisWeek,
    readTotal: [...reads.values()].reduce((sum, n) => sum + n, 0),
  };
}
