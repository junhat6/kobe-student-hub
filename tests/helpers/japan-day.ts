/** Calendar day in Japan as the public pages print it (YYYY.MM.DD). */
export const japanDay = (ms = Date.now()) =>
  new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll('-', '.');
/** Days a publication made during this test can show (a run may cross midnight in Japan). */
export const japanDaysSince = (startMs: number) => [japanDay(startMs), japanDay()];
