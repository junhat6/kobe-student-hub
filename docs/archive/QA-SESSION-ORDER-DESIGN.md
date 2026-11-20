# セッション応答順候補 — 独立設計レビュー

2026-11-05。別コンテキストのレビュー担当が、設計・閉じたモデルと現行SessionStore／private最終SQLを確認。対象HEAD `579ba0aec7e341b808a33a780d41e80db15fbebb`、設計ブランチ上の未コミット資料。app、schema、runtime、認証ゲート、実Google、鍵、権限、実データ、remote設定は変更していない。

## 判断

**ローカル専用D1/HTTP fixtureへ進める候補として支持する。認証公開や本体への実装承認を意味しない。** 古いヘッダーの適用そのものではなく、そのtokenの受理を拒否する設計であり、BからAへの取り違えとログイン喪失を区別している。start失敗でも以前のsessionを失効させ、回復には明示した新しい認証を要求する代償は文書化されている。

最小要件は、request contextとtoken contextの一致、現在generationとの一致、従来のaccount epoch・active・期限・失効条件を、すべての認証とprivate最終SQLで確認すること。SessionStoreだけの修正では成立しない。logoutは古いsession Cookieでも使える別のcontext/action-bound CSRFを要し、世代更新を現在tokenの有効性に依存させない。contextからsessionを再発行しない境界は固定化・context窃取時の権限昇格を避けるため必須。

## bootstrapの因果条件

候補の説明は条件付きで整合している。新規contextを返す唯一の応答が匿名bootstrapだけであり、そのCookie適用後にしかattempt/sessionを作れなければ、まだ一度も適用されていない遅延bootstrapに対応する既発行sessionは存在できない。別contextのsessionと組み合わされるとsigned-outになる。その後の明示startは新しい操作である。

これはcontext Cookieの永久不変を証明するものではない。通常経路での再発行、同じbootstrap応答の再適用、cache/retry、期限延長・rotationを許すと根拠が崩れる。既存contextを再発行する反例がfixtureに残る点は適切。Cookie全体の盗難・任意復元はこの順序モデルの外である。実HTTPの全Set-Cookie emitter、no-store、first-use、ブラウザの応答適用と再送を次段階で検証する必要がある。

## 実行した検査

`npx vitest run tests/session-order-design.test.ts tests/session-order-design-review.test.ts`：**2 files / 19 tests passed**（2026-11-05 15:00 UTC）。既存15ケースに加え、独立レビューの別ファイルで次を実行した。

- callback requestが捕捉したcontextを後のCookie変更から分離し、bootstrap/start/claim/issue/headerの二系列252通りを検査。各段階で認証されたactorが最後の確定startのactorと一致することを確認。
- claim後にcontextが期限切れになった場合のsession発行／final write／logout拒否。
- generation上限でstart/logoutが状態を変更せず拒否されること。
- 完了済みlogoutコマンドをBログイン後に再送するとBがsigned-outになる未解決反例。誤ったactorの受理ではなく可用性の問題として記録。

既存70順序と追加252順序は限られた因果列の列挙であり、全プロトコルの形式的証明ではない。元の70順序はissue時に可変jarのcontextを読むため、追加試験では捕捉したrequest contextを保持した。レビュー中に指摘したstart/logoutのaction proof共有は、作成者がモデルを修正し、cross-action拒否を既存テストで確認した。

## 残る検証条件

- 各モデルメソッドは原子的と仮定する。実D1でgeneration incrementとattempt結合を同じtransactionとして成立させ、callback INSERT／全private最終SQLで現在世代を再検証すること。read replica等の古い権威状態を許さない。
- `claim`と`issue`はprovider成功を仮定した二段階モデルである。実装では単なるconsumedフラグを見た別リクエストに完了権限を与えず、claim所有者だけが一度完了できること。交換失敗・曖昧なDB結果から消費状態を戻したりcode交換を自動再試行したりしない。
- proofは決定的なテスト用文字列であり、実暗号・Origin／fetch metadata・action binding・bootstrap前のCSRF防護・窃取耐性を検証していない。CSRF取得はactor/session回復経路になってはならない。
- action-bound CSRF自体はコマンドの一回性ではない。完了済みstart/logoutの重複再送は世代を再更新できる。設計文書はこの可用性上の残条件を明示している。次のfixtureでは一回用command nonce／idempotencyと曖昧なDB確定結果を検証するか、expected-generation拒否に意味を変えるかを先に決める必要がある。後者は遅延logoutを最後の確定操作として扱う現契約にも影響する。
- モデルのcommitは認証を再実行するが、実SQLや全read/write経路の網羅ではない。read後の遅延レスポンス、最終SQL後の世代変更、UI隠蔽・入力破棄・503時の保持と明示再開は別のHTTP／ブラウザ試験が必要。
- context寿命・cleanup／tombstone、idle寿命、失効tokenのCookie保持とログ保護、レート制限・context窃取によるDoS、別端末、操作警告と復旧導線は未実装。

検査対象SHA-256：

| ファイル | SHA-256 |
| --- | --- |
| `docs/SESSION-ORDER-DESIGN.md` | `61d60c9c29894e1dbb3b33e539e13ae01885be1ad02c3984438309e5b3764a48` |
| `tests/fixtures/session-order-model.ts` | `1a7f99ff2a421709fb4f9713683aefab485f3516d89461309a90fdff5bf1b241` |
| `tests/session-order-design.test.ts` | `a5b182f2dab8776580dc181a4eef2a04a0498b846f4c03703ce98419b2f5bf3a` |
| `tests/session-order-design-review.test.ts` | `29010b590cfa26d0ee14ce12bd4e38ac57d1af612f36bd17aaa8152ad0944691` |
