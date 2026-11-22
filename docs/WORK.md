# Current work

- 2026-11-22 replan#9：完成台帳 [completion.json](loop/completion.json) は **pass 20/21**。7427fdc の「自分のAIエージェントで書き・読める」を C21（unverified）として追加し #196 に積んだ。patrol は前回（f5d21f1）で J0〜J5 合格、S1/S2 0件。
- 本番：最新 tag `r2026.11.22.2`（a678c16）。favicon・manifest・robots.txt、運営者「Kobe Student Hub 運営委員会」と免責事項（/guide#disclaimer）を含む。rc/8ad2739・rc/5106bce はフッター/目次の44px（Linux フォントで折れる）と #192 の揺れで赤 → a678c16 で green。a678c16 以降の main（マイページ改修など）は未反映、migration なし（D1 は 0026 まで）。
- 2026-11-22 オーナー指摘でマイページを改修（712f477〜85acea7）：プロフィール先行・入学/卒業予定の月表示の選択・確認ボタン廃止・コピーのアイコン化。UI/UX 改善係 `ksh polish`（10:30〜22:30 JST 3時間ごと、[polish.md](loop/prompts/polish.md)、記録は #197）を登録。アバターは #198：第2段（0028 `profile_avatars`、本人の変更/削除、投稿者ページ・マイページ表示、運営の取り外し＋理由の通知）を main に入れ、R2 独立検証待ち。記事カード・記事の著者欄・ヘッダーの表示は未着手（次段）。
- 待ち行列：P0 0件、P1 4件（#192 rc の test の揺れ、#196 C21 確認、#188 媒体上限の定数1か所化と理由文 → #195 上限引き上げ migration）、claimed 0件。P2 13件（loop:ux #143 #168 #173 #174 #178 #179 #185 #190 #194、loop:finish #193、loop:garden #177 #187 #189）。
- needs-human：#12 R2 画像の課金・契約条件、#5 学生による試用（実利用者、H02〜H04 の確かめ方もここ）。
- 次の焦点：マイページ改修を `npm run release -- --deploy` で本番へ昇格 → #196 C21 の確認（プロフィール先行に変わったので J1〜J3 も見直す） → #188 → #195 → #193（前提の agent 作業は main に入った）。
