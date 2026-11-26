/**
 * The owner's taste in articles, distilled from editorial reviews (operator-only, D1
 * `editorial_reviews`) and from how the owner edits AI drafts before publishing.
 *
 * Single source for every writing path: the copy-paste request (buildWritingRequest), the MCP
 * writing guide (worker/agent/guide.ts) and the public skill (public/agent-kit/ksh-article/SKILL.md,
 * kept equal by tests/editorial-taste.test.ts). Only the editor loop (docs/loop/prompts/editor.md)
 * rewrites it. Lines are abstract rules: never quote a review note, an article or an author.
 *
 * Each line ends with its basis: (オーナー指示 YYYY-MM-DD) or (レビュー n件 YYYY-MM-DD).
 */
export const EDITORIAL_TASTE_UPDATED = '2026-11-26';

export const EDITORIAL_TASTE = `- 本人の言い回しをそのまま残す。感想を盛らない・言っていないことを足さない。足りないところは「（ここに〇〇を書く）」と空ける（オーナー指示 2026-11-22）
- 読んだ人がすぐ動ける具体を入れる。お店なら「何人なら入れるか」「いくらぐらいか」「混むと遅い」など、行く前に知りたいこと（オーナー指示 2026-11-22）
- 良かったことも合わなかったことも正直に書く。合わなかった店も、事実と本人の好みとして短く書く（オーナー指示 2026-11-22）
- 写真・図を多めに。見出しごとに1枚以上が目安（オーナー指示 2026-11-22）
- お店の記事は1本に1店。何軒か行っても、まとめずに店ごとに1本ずつ書く（オーナー指示 2026-11-23）
- 「（ここに〇〇を書く）」で空けるのは、本人がすぐ埋められる大事な所だけに絞る。中身の無い見出しだけの節は作らない（レビュー 8件 2026-11-26）
- タグは読む人が探しそうな言葉にする。料理や分野の種類と、広く使われている地名を選ぶ（レビュー 5件 2026-11-26）`;

/**
 * The app-side half of the owner's ledger: tendencies the owner keeps fixing by hand because of
 * the app, not the writing (DECISIONS 2026-11-23). Never passed to any writing path; the editor
 * loop turns each line into a loop:ux / loop:finish Issue, and the operator's 好み screen shows it.
 * Same line format and the same "never quote" rule as EDITORIAL_TASTE. Empty until 3+ signals agree.
 */
export const EDITORIAL_PRODUCT_NOTES = `- AI の下書きの先頭の（AIメモ）を、公開の前に毎回手で消している（差分 8件 2026-11-26）
- 写真の置き場所の印（写真：…）を、公開の直前に手で本物の写真へ差し替えるか消している（差分 7件 2026-11-26）`;
