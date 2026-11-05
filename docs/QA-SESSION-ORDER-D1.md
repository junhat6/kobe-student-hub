# セッション応答順 — ローカル D1/HTTP 独立 QA

2026-11-05。独立した別コンテキストで `test/session-order-d1-http`、基点 `800c5ec226086110e2fe253759d799faafbe6e3d` を確認。対象は専用 `lab_*` スキーマ、Worker fixture とその HTTP 試験のみ。実アプリの認証、migration、runtime データ、Google、鍵、設定、認証公開ゲート、remote deployment は変更しない。

## 判断と実行結果

**閉じたローカル fixture の候補として支持する。この範囲で残る blocking finding はない。本体への移植・認証公開の承認ではない。** source と SQL、Cookie 発行箇所、helper の outbound 拒否を確認し、別コンテキストで fixture を再ビルドした。

`node scripts/build-test-fixtures.mjs` が成功。続けて `npx vitest run tests/session-order-http.test.ts tests/session-order-http-review.test.ts tests/session-order-design.test.ts tests/session-order-design-review.test.ts` を loopback listener 用権限で独立実行し、**4 files / 47 tests passed、741ms**（2026-11-05 06:13 UTC）。内訳は実装側 HTTP 24 件、独立追加 HTTP 4 件、既存モデル 19 件。`git diff --check` も成功。既存モデルだけの先行再実行は 2 files / 19 tests passed、71ms。

HTTP は Node fetch から実際の 127.0.0.1 動的 port を使い、Worker/Miniflare D1 を通した。架空 provider は outboundService で捕捉し、他宛先は拒否する。Cookie jar はテストコードであり、Secure/SameSite/HttpOnly の実ブラウザによる適用確認ではない。

実装側試験は、匿名 bootstrap、同時 start と command replay、batch rollback、不明 commit、二重 callback、provider 失敗、一回 claim、交換中の世代変更、遅延 session/attempt/bootstrap ヘッダー、最終 private SQL、logout と再送、action/context binding、端末分離、期限・overflow・削除、不一致 Cookie、account snapshot/epoch、正常 read/write と CSRF、DB エラーを確認した。

独立追加ファイルでは次を実行した。

- private read/write の成功 preflight 後に account status/epoch を変更する 4 パターン。最終 SQL が 401 を返し、架空 private record を返さず、version を変えない。
- identity snapshot 後の pause 中に context を期限切れにし、attempt と account が残っていても session Cookie を発行しない。
- 同じ expected epoch に対する start/logout を 8 回競合。毎回一方だけ確定し、epoch は一つだけ進む。
- logout batch の後段 SQL 失敗で command と epoch が戻り、既存 A session が有効なまま。再試行成功後は A が失効し、後の B login に対する完了済み logout 再送は世代を変えない。

これらは有限の指定順序の実行であり、任意配送順の形式的証明ではない。build/typecheck、全体 suite、既存 browser suite は本 QA では実行していない。

## D1 と SQL の評価範囲

[D1Database 公式仕様](https://developers.cloudflare.com/d1/worker-api/d1-database/) は `batch()` の順次実行とエラー時の全体ロールバックを定義する。条件付き UPDATE の 0 行更新は SQL エラーではないため、成功確認と後続処理の結合は別途必要。今回の候補は、一回用コマンドの条件付き UPDATE と SQLite trigger 内の世代更新・attempt 作成を結び付け、RETURNING の結果で勝者を識別する。

[D1 の複製仕様](https://developers.cloudflare.com/d1/best-practices/read-replication/) では、Sessions API を使わない DB 経路は primary で実行される。`first-primary` は最初の query だけを primary にするため、長く共有する Session の後続読取まで他リクエストの最新 commit を反映する保証とは扱えない。今回の fixture は直接 `env.DB` を使う。ローカル Miniflare の成功は remote D1 の複製・運用設定の実証ではない。

## 契約上の境界

- コマンドの proof は context/action と取得時の expected epoch に固定。未確定の古い logout が新しい start 後に到着すると拒否する。以前のモデルの「到着が遅くても最後に確定した logout が B を失効」の例と異なる。完了済みコマンドは Cookie を再発行せず acknowledgment のみ返す。
- account epoch は synthetic provider で本人が決まった後に取得し、session INSERT で一致を再確認する。それ以前の account-wide epoch 更新を、まだ本人未決定の attempt の失効とする設計ではない。
- 専用スキーマの session は context、generation、account status/epoch、一つの expiry を検査する。既存アプリの revoked/idle/absolute/clock 条件を全て移植した fixture ではなく、既存 private repositories 全経路の監査完了でもない。
- provider、pause/fault headers、架空 actor DTO はローカルの試験用。実 Google、署名、PKCE/state/nonce の本物の検証、資格確認、実ブラウザ、platform logs、UI 復旧を証明しない。

## 確認対象の SHA-256

| ファイル | SHA-256 |
| --- | --- |
| `tests/fixtures/session-order-http-worker.ts` | `f98500b946d1914b04471945d5caf3c81fad95f1b6aeb8f94493086c83b3906e` |
| `tests/fixtures/session-order-lab.sql` | `6fb77fac27f55cf056fa1ebe5d3f2b3e6defe54eb4641f87c0df5d81ed0268f3` |
| `tests/helpers/session-order-http.ts` | `289426a93a128ca32c7fa998ea8ef604e8ed71f5ca3d16095006d45026f989ca` |
| `tests/session-order-http.test.ts` | `299ad9dbf5ff181b524ff8adce044cb674156248ae303b79be0db2856cf6ea95` |
| `tests/session-order-http-review.test.ts` | `e0427d815d9563a6aa6d3b9fbc573073f53d8dcb3d30548a06f3afd94505a851` |
| `scripts/build-test-fixtures.mjs` | `8a0dbfe654951856348818d9dbf2496e05a3c6c20b4409183deec92bf32c555d` |
