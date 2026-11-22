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
export const EDITORIAL_TASTE_UPDATED = '2026-11-22';

export const EDITORIAL_TASTE = `- 本人の言い回しをそのまま残す。感想を盛らない・言っていないことを足さない。足りないところは「（ここに〇〇を書く）」と空ける（オーナー指示 2026-11-22）
- 読んだ人がすぐ動ける具体を入れる。お店なら「何人なら入れるか」「いくらぐらいか」「混むと遅い」など、行く前に知りたいこと（オーナー指示 2026-11-22）
- 良かったことも合わなかったことも正直に書く。合わなかった店も、事実と本人の好みとして短く書く（オーナー指示 2026-11-22）
- 写真・図を多めに。見出しごとに1枚以上が目安（オーナー指示 2026-11-22）`;
