# Private draft storage 独立QA

対象はIssue #28の未接続private article draft backend。実装者とは別コンテキストで設計/source/schema/document reviewとlocalWorkers/D1独立実行を行った。実装・テストを独立側で変更していない。検証対象は末尾hashで固定する。

## 判定と修正

最終検証範囲でblocking不具合は確認しなかった。レビューで次を指摘し、実装者が修正した。

- storageAuthorizationの時刻取得をawait tokenHashより後に移し、crypto待ち前の古い時刻を最終SQLへ渡さない。最終SQLはcreated/lastSeen/idle/absoluteを再検査し、clockrollbackも拒否する。remoteDBcommit wallclockまでの厳密保証ではなくrequest側判断時刻である。
- titleのUnicode配列化前にUTF16長400以下を安価に検査し、巨大入力から無制限の配列を作らない。200 code pointsとbody256KiB UTF8の判定を保つ。
- MAX_SAFE_INTEGER-1からの更新でMAX_SAFE_INTEGERに達した下書きが削除不能になる共通guardを修正。更新は増分可能な値だけ、削除はsafe ceilingまで許容し、schemaもsafe上限を持つ。直接境界fixtureで更新→上限更新拒否→削除成功を確認した。

加えて、一覧の異なる更新日時によるnewest-firstと同時刻ID順、認証直後のstatus/epoch変更のテストを実装者へ依頼し最終版で通過した。revokeだけでなくaccount状態の最終SQL再検査を証拠化している。

## 設計・privacy境界

create/read/list/update/deleteはRequestから実SessionStoreを使い、unsafe操作は同一Origin・Fetch Metadata・session固有CSRFを要求する。server-private storage proofはtoken hash/account/timeだけを返し、client入力からownerやstatusを採用しない。各最終parameterized SQLはlive token/session/account active/epoch/timeとstoredownerを同時に確認する。update/deleteはexpectedVersionも同一statementに含め、認証→変更の間の失効/停止を先行チェックだけで許可しない。

明示DTOはid/title/body/version/updatedAtだけ。listはbodyを含めないmetadata20件、updatedAt降順・ID昇順で固定。live/no draftは[]、最終SQL前に失効した場合はnullとなる。missing/他owner/conflictは同じnullで内容や個別理由を返さない。これはresponse内容の境界であり全timing sidechannel不在の証明ではない。

strict field検査はplain object/null prototypeと全own keysを確認し、owner/status/publish等を拒否する。空title/bodyは執筆途中として許容。bodyはUTF8 byte上限、IDはserver UUID、version1で作成する。最終SQLは保存済ownerとsessionの両方を使うため、private record IDを知っているだけでは利用できない。

## 独立実行

実装者のfinal ready後、fixtureを自分で再bundleした。

```sh
node scripts/build-test-fixtures.mjs
npx vitest run tests/drafts.test.ts tests/sessions.test.ts tests/google-login.test.ts tests/worker.test.ts
```

**40件成功、4 files、10.75秒**（draft12/session12/google10/publicWorker6）。localMiniflare隔離DBのみを使用し、persistent local D1やremoteへ操作していない。sandbox許可はlocalWorkers実行のため。親のfull117tests/UI E2Eとは独立範囲を区別する。

draft12件は不完全draft CRUD・DTO、他owner/missing/conflict、12同時更新の1winner/replay拒否、20件metadataと同時刻ID順/異時刻newest-first、privileged/誤形式/過大入力、Unicode/256KiB境界、version ceiling、Origin/CSRF、idle/absolute/clockrollback、認証直後revokeを全5operationで拒否、status/epoch race、suspend/reactivate旧session拒否を実行した。raceはtestfixtureが実認証のDB更新直後に保存状態を変更する注入で、production endpointではない。

publicWorker testにはlocal private account/session/draft markerを配置し、公開sampleprojection4件/2profilesへ漏れないことを確認。GET/POST/PUT/DELETEのdraft routeは未接続405のまま。production worker/index.tsは変更されていない。今回UIはないためscreenshotを追加していない。

## 文書と未提供事項

PRIVATE-DRAFTS.mdはPC/mobile下書き引継ぎの必要backendを、実editor/autosave/crossdevice体験の提供と区別している。stale時の未保存文字保持はfuturecaller/UIの責務と修正済み。media/moderation/運営条件を迂回せず、owneractiveを現在在籍の証明にしない。200 codepoint/256KiB/20件は技術既定でありproduct合意・pagination完備と主張しない。

remote0004/0005は未適用。realGoogle/controller/browsercookie、privateHTTPno-store/errors、入学/卒業/admission、rate/総quota、UI保存状態/回復/競合表示、画像/メディア、公開/通報/通知/復元/異議、実secretログgate、運用retention、学生価値は未実施/未提供。認証設定/credentials/newgrant/R2/契約/remote操作を独立側は行っていない。testfixtureのidentityJSON/DB race注入を公開してはいけない。

## 対象SHA256

```text
e31d53843bae8f8165552bf5ede4e61477b29b0dd4a90924dcc935bdcfbf58d7 worker/drafts.ts
76c9eb6c6c10a9a375440b82bf68b1c5b9de2d0f4c314c4d129358fc8e11476b worker/auth/sessions.ts
1e6c1de977191a38077572e4db3f5071ac12aa28d1b4799e86a733db607ac70c migrations/0005_private_article_drafts.sql
802f3ae4f302660a3f81761c01e04d9acc0f69f31a632dabb9d7faa9d5e9a1ad tests/drafts.test.ts
fda27aaceb18b761a952199dac203b61b0588dc19428721ff5e960bf3f4ddcb5 tests/fixtures/draft-worker.ts
ced34e0eeb8e5489bfa19657dbf7426ad23771b0ea9854c3d94dd98c68bc16a5 worker/index.ts
```
