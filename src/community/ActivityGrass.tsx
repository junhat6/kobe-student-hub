import { useEffect, useMemo, useState } from 'react';
import { createPublicStudentClient, validActivity } from './student-client';
import { buildGrass } from './grass';
import { milestones } from './milestones';
import type { PublicStudentActivity } from '../public-student-types';
import Icon from '../shared/Icon';
import './grass.css';

/** An empty window ending today (Japan), for one's own page before anything is public. */
export function emptyActivity(nowMs: number): PublicStudentActivity {
  const day = Math.floor((nowMs + 9 * 3600000) / 86400000);
  const iso = (d: number) => new Date(d * 86400000).toISOString().slice(0, 10);
  return { from: iso(day - 26 * 7 + 1), to: iso(day), days: [] };
}
function useActivity(id: string | undefined, own: boolean) {
  const client = useMemo(() => createPublicStudentClient(), []);
  const [value, setValue] = useState<{ id: string; activity: PublicStudentActivity } | null>(null);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    client.readActivity(id, controller.signal).then(
      (activity) => setValue({ id, activity }),
      // The grass is decoration on top of the profile: a failed read shows nothing. On one's
      // own page "not public yet" is the empty field the first publication will grow.
      (error: unknown) => {
        if (own && (error as { missing?: unknown })?.missing === true)
          setValue({ id, activity: emptyActivity(Date.now()) });
      },
    );
    return () => controller.abort();
  }, [client, id, own]);
  return value && value.id === id ? value.activity : null;
}

/**
 * Owner-only count of what is public right now (articles + projects, each list bounded to 20),
 * for the milestones. Not public yet is 0; a failed read is null and hides the milestones.
 */
function useOwnPieces(id: string | undefined) {
  const client = useMemo(() => createPublicStudentClient(), []);
  const [value, setValue] = useState<{ id: string; pieces: number } | null>(null);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    client.read(id, controller.signal).then(
      (student) => setValue({ id, pieces: student.entries.length + student.projects.length }),
      (error: unknown) => {
        if ((error as { missing?: unknown })?.missing === true) setValue({ id, pieces: 0 });
      },
    );
    return () => controller.abort();
  }, [client, id]);
  return value && value.id === id ? value.pieces : null;
}

/**
 * Owner-only reading layer (private reading history, counts per day). Failure or absence just
 * leaves the publication grass as it is; it is never shown anywhere but one's own page.
 */
function useOwnReading(fetcher: typeof fetch | undefined) {
  const [value, setValue] = useState<PublicStudentActivity | null>(null);
  useEffect(() => {
    if (!fetcher) return;
    const controller = new AbortController();
    fetcher('/api/private/activity', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (validActivity(body)) setValue(body);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [fetcher]);
  return value;
}

/**
 * The "grass": one square per day, greener the more the student published that day.
 * `own` adds the nudge that keeps a weekly streak going; the public view only shows facts.
 */
export default function ActivityGrass({
  id,
  own = false,
  fetcher,
}: {
  id?: string;
  own?: boolean;
  /** Signed-in fetcher; only given on one's own page, where viewing also grows the grass. */
  fetcher?: typeof fetch;
}) {
  const activity = useActivity(id, own);
  const reading = useOwnReading(own ? fetcher : undefined);
  const pieces = useOwnPieces(own ? id : undefined);
  if (!activity) return null;
  const grass = buildGrass(activity, own ? reading : null);
  const marks = own && pieces !== null ? milestones(pieces, grass.bestStreakWeeks) : null;
  const label =
    `過去半年の公開：${grass.activeDays}日・${grass.total}件` +
    (grass.streakWeeks ? `、${grass.streakWeeks}週連続` : '') +
    (own && grass.readTotal ? `、閲覧${grass.readTotal}（自分だけ）` : '');
  let nudge = '';
  if (own && grass.total === 0) nudge = '最初の1本で芽が出ます';
  else if (own && !grass.thisWeek && grass.streakWeeks > 0)
    nudge = `今週も出すと${grass.streakWeeks + 1}週連続`;
  return (
    <section className={'grass' + (own ? ' grass-own' : '')} aria-label="草">
      <div className="grass-stats">
        {/* The unit says what the number counts; the grid's label reads the full sentence. */}
        <span className="grass-chip" aria-hidden="true" title={`過去半年の公開 ${grass.total}件`}>
          <Icon name="sprout" size={16} />
          {grass.total}件
        </span>
        {grass.streakWeeks > 0 && (
          <span
            className={'grass-chip grass-streak' + (grass.thisWeek ? ' is-lit' : '')}
            aria-hidden="true"
          >
            {grass.streakWeeks}週連続
          </span>
        )}
        {own && grass.readTotal > 0 && (
          <span
            className="grass-chip grass-read"
            role="img"
            aria-label={`閲覧 ${grass.readTotal}（自分だけに見えます）`}
            title="閲覧（自分だけに見えます）"
          >
            <Icon name="eye" size={16} />
            {grass.readTotal}
            <Icon name="lock" size={12} />
          </span>
        )}
        {nudge && <span className="grass-nudge">{nudge}</span>}
      </div>
      <div
        className="grass-grid"
        role="img"
        aria-label={label}
        style={{ gridTemplateColumns: `repeat(${grass.weeks.length}, 1fr)` }}
      >
        {grass.weeks.flatMap((week, w) =>
          week.map((cell, d) => (
            <span
              key={cell.date}
              className={
                'grass-cell' +
                (cell.outside ? ' is-outside' : ` level-${cell.level}`) +
                (cell.date === activity.to ? ' is-today' : '')
              }
              style={{
                gridColumn: w + 1,
                gridRow: d + 1,
                animationDelay: `${Math.min(w * 18, 480)}ms`,
              }}
              title={
                cell.outside
                  ? undefined
                  : own && cell.read
                    ? `${cell.date}：公開${cell.count}・閲覧${cell.read}`
                    : `${cell.date}：${cell.count}件`
              }
            />
          )),
        )}
      </div>
      {marks && marks.reached.length > 0 && (
        <ul className="milestones" aria-label="節目（自分だけに見えます）">
          {marks.reached.map((m, i) => (
            <li
              key={m.key}
              className="milestone is-reached"
              title={m.detail}
              style={{ animationDelay: `${500 + i * 120}ms` }}
            >
              <Icon name={m.icon} size={16} />
              {m.label}
            </li>
          ))}
          {marks.next && (
            <li className="milestone is-next" title={`次の節目：${marks.next.milestone.detail}`}>
              <Icon name={marks.next.milestone.icon} size={16} />
              {marks.next.milestone.label}
              <span className="milestone-left">
                あと{marks.next.left}
                {marks.next.unit}
              </span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
