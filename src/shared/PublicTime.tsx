import './public-time.css';
import { formatPublicTime, japanDateTimeTitle, japanDayOf } from './display';

/**
 * A public publish time (#308): relative while recent, the day from 7 days on. `datetime` carries
 * the exact time and `title` the Japan date and time when the Worker sent one; otherwise the day.
 */
export function PublicTime({ day, at }: { day: string; at?: string }) {
  const title = at === undefined ? undefined : japanDateTimeTitle(at);
  return (
    <time className="public-time" dateTime={title ? at : day} title={title}>
      {formatPublicTime(day, title ? at : undefined)}
    </time>
  );
}

/** A notice's time (UTC ms) in the same relative wording as public pages (#308). */
export function NoticeTime({ at }: { at: number }) {
  const iso = new Date(at).toISOString();
  return <PublicTime day={japanDayOf(iso) ?? iso.slice(0, 10)} at={iso} />;
}
