import type { PublicStudentActivity } from '../public-student-types';

export interface GrassCell {
  date: string;
  count: number;
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
  /** True when this week already has activity. */
  thisWeek: boolean;
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
export function buildGrass(activity: PublicStudentActivity): Grass {
  const counts = new Map(activity.days.map((d) => [d.date, d.count]));
  const first = dayNumber(activity.from);
  const today = dayNumber(activity.to);
  const start = first - weekday(first);
  const end = today + (6 - weekday(today));
  const weeks: GrassCell[][] = [];
  for (let day = start; day <= end; day += 7) {
    const week: GrassCell[] = [];
    for (let offset = 0; offset < 7; offset++) {
      const d = day + offset;
      const count = d >= first && d <= today ? (counts.get(iso(d)) ?? 0) : 0;
      week.push({
        date: iso(d),
        count,
        level: count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : 3,
        outside: d < first || d > today,
      });
    }
    weeks.push(week);
  }
  const active = weeks.map((week) => week.some((cell) => cell.count > 0));
  const thisWeek = active[active.length - 1] ?? false;
  let streakWeeks = 0;
  for (let i = active.length - (thisWeek ? 1 : 2); i >= 0 && active[i]; i--) streakWeeks++;
  return {
    weeks,
    total: activity.days.reduce((sum, d) => sum + d.count, 0),
    activeDays: activity.days.length,
    streakWeeks,
    thisWeek,
  };
}
