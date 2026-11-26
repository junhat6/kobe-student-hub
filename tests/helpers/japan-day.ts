/** Calendar day in Japan as the public pages print it (YYYY.MM.DD). */
const japanDay = (ms = Date.now()) =>
  new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll('-', '.');
/** Days a publication made during this test can show (a run may cross midnight in Japan). */
export const japanDaysSince = (startMs: number) => [japanDay(startMs), japanDay()];
/** A just-published item reads relative (#308); `datetime` keeps the time and `title` the Japan date and time. */
export const recentLabel = /^(たった今|\d+分前)$/;
export const japanTitle = /^\d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}$/;
export const japanDayOfIso = (iso: string | null) => japanDay(Date.parse(iso ?? ''));
