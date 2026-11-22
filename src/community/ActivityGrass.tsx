import { useEffect, useMemo, useState } from 'react';
import { createPublicStudentClient } from './student-client';
import { buildGrass } from './grass';
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
 * The "grass": one square per day, greener the more the student published that day.
 * `own` adds the nudge that keeps a weekly streak going; the public view only shows facts.
 */
export default function ActivityGrass({ id, own = false }: { id?: string; own?: boolean }) {
  const activity = useActivity(id, own);
  if (!activity) return null;
  const grass = buildGrass(activity);
  const label =
    `過去半年の公開：${grass.activeDays}日・${grass.total}件` +
    (grass.streakWeeks ? `、${grass.streakWeeks}週連続` : '');
  let nudge = '';
  if (own && grass.total === 0) nudge = '最初の1本で芽が出ます';
  else if (own && !grass.thisWeek && grass.streakWeeks > 0)
    nudge = `今週も出すと${grass.streakWeeks + 1}週連続`;
  return (
    <section className={'grass' + (own ? ' grass-own' : '')} aria-label="草">
      <div className="grass-stats">
        <span className="grass-chip" aria-hidden="true">
          <Icon name="sprout" size={16} />
          {grass.total}
        </span>
        {grass.streakWeeks > 0 && (
          <span
            className={'grass-chip grass-streak' + (grass.thisWeek ? ' is-lit' : '')}
            aria-hidden="true"
          >
            {grass.streakWeeks}週連続
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
              title={cell.outside ? undefined : `${cell.date}：${cell.count}件`}
            />
          )),
        )}
      </div>
    </section>
  );
}
