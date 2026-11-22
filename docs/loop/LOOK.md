# 画面・挙動の確かめ方 — 自分で撮り、Antigravity に見せる

2026-11-23 作成。エージェントが hub の画面や挙動を知りたいときの標準の流れです。
部品は `scripts/loop/look.mjs`（撮る）と `scripts/loop/look-review.mjs`（Antigravity に見せる）。
人が実機で撮った hub の動画は `ksh-video-review`（[prompts/video-review.md](prompts/video-review.md)）が受け持ちます。

## 結論

1. **hub の画面・挙動は、人に頼まずエージェントが自分で撮る。** `npm run look` で PC(1280×800) とモバイル(390×844) のスクリーンショットを撮り、`--video --steps` で操作を録画する。人に撮ってもらうより速く、同じ条件で何度でも撮り直せる。
2. **見た目と動きの判定は Antigravity CLI（`agy`、Gemini）に渡す。** `npm run look:review` が、シェルを禁じてファイルを読むだけの `agy` に画像・動画と [ux-rubric.md](ux-rubric.md) を渡し、所見を JSON で受け取る。作ったのは Claude、見るのは Gemini なので、作る人と評価する人を分ける原則（[README](README.md) 原則3）が別の会社のモデルにまで広がる。
3. **Antigravity の所見は候補であって、事実ではない。** 呼んだ側が、コード（`rg`）か画像で1件ずつ確かめてから Issue や修正にする。
4. **人が撮るのは、エージェントでは撮れないものだけ。** 実機での hub（viewport ≠ 実機）と、参考にする別アプリの動き。

## 誰が何を撮り、誰が見るか

| 対象 | 撮る | 見る | 結果の置き場 |
| --- | --- | --- | --- |
| hub の画面（PC/モバイル viewport） | エージェント `npm run look` | 自分で Read（静止画を素早く確かめる）＋ `npm run look:review`（独立した目） | 架空データか本番の未ログイン画面なので、公開 Issue に書いてよい |
| hub の操作の流れ（録画） | エージェント `npm run look -- --video --steps <file>` | `npm run look:review`（Claude は動画を読めないので必ず渡す） | 同上 |
| hub を実機で操作した動画 | 人（スマホ） | `ksh-video-review <動画> --note "…"` | 非公開。Issue は言い換えた文と、エージェントが撮り直した画面で書く |
| 参考アプリの実機の動き | 人（スマホ・Air） | `npm run look:review -- <動画> --kind reference` | 非公開。借りる型は ux-rubric の「見比べる型」か commit 本文へ |

## エージェントの手順

```sh
npm run build && npm run db:local && npm run preview   # 閲覧系（:8787）。投稿系は npm run editor:preview（:8788）
npm run look -- / /works                               # → .look/<時刻>/ に *-pc.png *-mobile.png look.json
npm run look -- --base editor --video --only mobile --steps .look/steps.mjs /drafts
npm run look:review -- .look/<時刻> --focus "公開ボタンを押した後"
```

- `--base` は `local`（:8787）・`editor`（:8788）・`session`（:8790）・`prod`（本番、未ログインで見るだけ）のどれか。任意の URL は撮らない（利用者のログイン状態や他人のサイトを外部へ送る経路を作らないため）。
- `--steps` のファイルは `export default async (page, { path, viewport }) => { … }`。クリック・入力・スクロールが録画に残る。置き場所は `.look/`（gitignore）。
- `look.json` に HTTP 状態・コンソールのエラー・5xx・横はみ出しが入る。`⚠` が出たらまずそれを見る。
- `look:review` は1回 30〜100 秒（`gemini-3.8-flash-high`、`LOOK_REVIEW_MODEL` で変更）。40ファイルまで、90MB を超える動画は ffmpeg で 720px に縮めてから渡す（`agy` の読み込みは1ファイル 100MB まで）。
- 結果は `.look/review-<時刻>/review.json` と `review.md`。送ったファイルの写しは消える。

### 所見を確かめる（必須）

2026-11-23 の試しでは、7件中5件が本物（`src/community/Search.tsx` の「記事：取得失敗」と説明文など）、2件が誤り（ソースに無い誤字、ローカル環境に設定が無いための 503 を S1 とした）だった。

- 文言の所見は `rg` でソースに在るか確かめる。無ければ捨てる。
- `API失敗時:` と付いた所見と `confidence: low` は、環境の都合でないか確かめる（本番の未ログイン画面 `--base prod` で同じか見る）。
- 確かめた所見だけを Issue（patrol）・修正（polish・finish）にし、commit 本文か Issue に「look:review」と1語残す。採用しなかった所見と理由は patrol/polish log に1行。

## 人が渡すとき

- **スマホで撮った hub の動画**：Drive の「hub動画ポスト」へ。Muse（ヨッチ）が `~/video-inbox/` に置き、`ksh-video-review` が見て、結果は Muse から返る（[prompts/video-review.md](prompts/video-review.md)）。Drive を経るので Muse の添付の容量制限（20〜25MB）に当たらない。
- **MacBook Air から**：Orca でエージェントのチャットに動画をそのまま添付する。添付は Mac mini の `~/Library/Application Support/orca/agent-session-attachments/<セッション>/` に原寸で置かれるので、エージェントはそのパスで `ksh-video-review <パス> --note "…"`（hub）か `npm run look:review -- <パス> --kind reference`（参考アプリ）を呼ぶ。
- 一言（何を確かめたかったか）を添えてもらうと、`--note` / `--focus` に入れて最優先で見させる。
- 人が撮ったものには実在の人・非公開の情報が映りうる。メディアも所見の原文も公開 Issue に貼らない。

## 止まったとき

- `agy` が無い・ログインが切れている：`look:review` がそう言って止まる。`needs-human`（Mac mini で `agy` に login）に積み、それまでは静止画を自分で Read して確かめる。動画しか無い挙動は、`look` の `look.json` と Playwright の検査で代える。
- 所見が返らない：`.look/review-<時刻>/agy.log` を読み、`--model` を変えて1回だけ試す。

## Antigravity を「係」にしない理由

`agy` は Orca の agent（`antigravity`）としても動くが、patrol・polish・finish を丸ごと Antigravity に替えることはしない（2026-11-23）。

- これらの係は `gh`・git push・Playwright・release を守る hook（`.claude/settings.json`。`agy` には効かない）の上で動く。替えると、得意でない部分まで任せ、守りが1枚減る。
- Antigravity が得意なのは画像・動画を見ること。そこだけを CLI 1回で呼べば、係の手順は変えずに目だけを別モデルにできる。
- Orca bots にもしない。bot は bot のフォルダで動き、リポジトリの worktree・Issue と切れる（[ORCA.md](ORCA.md) §2）。人の動画の窓口はすでに Muse と Orca チャットがある。

**見直す条件**：patrol/polish log で look:review の所見の採用率が 10 周続けて 7 割を超え、`agy` で `gh` と Playwright の手順が回ると確かめられたら、patrol の agent を `antigravity` にする試しを1回行う（automation の agent は戻せる）。
