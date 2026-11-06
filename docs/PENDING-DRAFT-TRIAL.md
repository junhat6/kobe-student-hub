# pending本人の期限付き下書き試用

Issue #4。既存Google署名検証・browser-bound OAuth・opaque session・CSRF・private draft storeを再利用し、限定restrictionとDB grantが一致するpending本人だけを試用対象とする。一般のSessionStoreはactiveのみを許可する。試用actorはpendingを明示し、アカウント承認やoperator付与はしない。DBのsubject照合、owner、epoch、grantのDB時計期限・取消を発行/認証/最終保存SQLで検証する。

専用入口は `/api/auth/draft-trial`。専用buildは `vite build --config vite.trial.config.ts`、成果は `.trial-assets`。別bindingのアダプターを用意したが、production entryには接続せず自動配備もしない。本番接続には対象Workerへの明示的なrouting/binding、限定runtime設定、スキーマ、本人1件のgrantを個別確認する。一般ログイン・公開・在籍承認の有効化ではない。

既存の編集画面とAuthorSessionGuardを使用する。通信不明時は未保存入力をメモリ内に保持して非表示にし、同一session確認後に再開する。別sessionや確定失効時は旧表示を破棄する。ページを閉じると未保存入力は失われる。既にDBで確定した操作は取消で遡及しない。

実装側: 全68ファイル580テスト成功。PC/mobile Chromiumエミュレーション8件成功（専用build/固定入口、保存再開、通信不明、session変更、期限、取消）。架空GoogleとローカルD1だけを使用。実本人の試用、本番D1、権限設定、配備は未実施。

独立QA: backend関連4ファイル47件、最終固定入口のPC/mobile8件を別コンテキストで実行し成功。静的レビューでは一般権限への流用拒否、origin・asset path・no-storeを確認し、阻害所見は報告されていない。実機・本番環境の証明とは区別する。
