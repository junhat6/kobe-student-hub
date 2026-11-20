# 認証試験テーブル追加の独立QA

対象は専用preview D1の `migrations/0003_oauth_attempts.sql` 追加。実装者とは別コンテキストでDDL/公開Workerレビュー、local tests、適用後のremote読み取りを実施した。ユーザーの具体的な追加許可を受け、親が以前未実行だった操作を一度再試行して成功したという実行報告を受領。独立側はDDL/ledger書き込みを実行していない。

## 判定とスキーマ

検証範囲でblocking不整合を確認しなかった。DDLはoauth_attemptsテーブルとoauth_attempt_expiry索引の追加のみで、既存テーブルの更新・削除を含まない。hash形式、nonce長、時刻/TTL上限、consumed時刻のCHECKを持つ。remote sqlite_masterのtable/index定義とPRAGMA table_infoを独立取得し、sourceと一致する6列・索引を確認した。ledgerは0001_discovery.sql、0002_sample_content.sql、0003_oauth_attempts.sql。attempt行数は **0**。schema/ledger/件数確認はすべてSELECT/読み取りPRAGMAで、API結果のrows_writtenは0だった。remoteへ試験attempt、dummy secret、credential、実ユーザー行は投入していない。

ソース照合SHA256:

```text
403eb50fdd28feee1cba1038c2ccc6eb9dae1d501a421f3d3a3e7531b606a9c4 migrations/0003_oauth_attempts.sql
ced34e0eeb8e5489bfa19657dbf7426ad23771b0ea9854c3d94dd98c68bc16a5 worker/index.ts
```

公開runtimeは親報告のmain `4d87f444fb2cf45a14f35d8521112c93c054186a` のまま。今回Worker再deployやUI変更はない。Worker sourceはauth helperをimportせず、sample専用projectionとAPI catchall405を維持する。テーブルがあることをログイン/投稿/セッションの完成と扱わない。

## 既存データ照合

専用DB名のexact matchが1つであることを確認して対象を選んだ。識別子やaccount情報はこの文書に載せない。独立read-onlyでcontent全列4行、public_profiles全列2行、total件数、旧ledger2行を取得し、親が適用直前に保存した `/tmp/kobe-auth-before-snapshot.json` と比較した。行順をid順とし、count列aliasのcontent/contents表記だけを正規化した後、**全4区分が構造的に完全一致**した。本文等の既存値変更は検出されなかった。

適用前snapshot自体は親が採取したものであり、独立側が適用前のremote状態を直接目撃したという主張ではない。照合範囲は架空sample全行・件数・旧ledgerであり、任意の将来データやサービス全体のバックアップ保証ではない。

## 独立テストと公開HTTP

親のlocal run終了通知後に実行:

```sh
npx vitest run tests/oauth-attempts.test.ts tests/worker.test.ts
```

**16件成功、2 files、674ms**。実local Workers/D1でattempt生成/ハッシュ保存/期限/誤browser/20同時claimで1winner/再利用拒否/cleanup/実署名とのtest-only結合を検証し、公開Workerのsample専用境界・closed routes・content revision保護を確認した。local fixture内のattempt操作はremoteテーブルへの操作ではない。親の全70testsとは実行範囲を区別する。

適用後公開originへ独立HTTP確認:

- GET /api/health: 200、writesEnabled=false、development-preview。
- GET /api/catalog: 200、sample記事作品4件/架空profiles2件。email/subject/nonce/state_hash/browser_hash/oauth_attemptsの語は公開JSONにない。
- 空POST /api/auth/callback、空POST /api/content: ともに405、Set-Cookieなし。

空POST拒否確認では実Google credential/code/stateや秘密queryを使っていない。UI変更がないため新しいscreenshotは追加していない。

## 未提供・未検証の境界

実OAuth開始/callback、PKCE/code exchange、browser binding transport、session/CSRF、学校在籍判定、登録・投稿・private endpoint、moderation運用は未接続。実Googleログイン、remote attemptのstart/consume/cleanup、実ログ秘匿監査、retention cron、学生による価値検証は未実施。今回の空テーブル追加とlocal replay testsはこれらのrelease gateを閉じない。TTLは保存期間保証ではなく、実cleanup運用も別途必要。

独立側はremote INSERT/UPDATE/DELETE/DDL、権限付与、secret作成、契約/R2/設定変更を行っていない。Cloudflareスキルを用いAPI仕様を確認してread-only検証した。アカウントID、DB UUID、runtime version、billing情報を公開文書へ記載しない。
