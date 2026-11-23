# Orca bots と自作ループの思想の違い

2026-11-22 作成。どちらの思想に寄せ、どう組み合わせるかの判断材料です。機能の有無の比較と最終構成は [ORCA.md](ORCA.md) に、ループ自体の思想は [README.md](README.md) にあります。

根拠にしたのは Orca のソースコードです（stablyai/orca、commit `56256d6dcd`）。主に読んだのは、bot の全セッションに必ず差し込まれる指示文 `src/main/bots/bot-preamble.ts`、定期的に「見て回る」処理の指示文 `bot-look-around-prompt.ts`、テンプレートの作り方 `bot-template-create.ts`、テンプレート一覧 `src/shared/bots/bot-template-catalog/*.ts`、組み込み skill の `bot-template-skills/workspace-hygiene.ts` です。

## 結論

- **土台は自作ループの思想のまま残す。** Orca bots は「1人の owner に仕える代理人」として作られていて、マージや削除などの最終判断を owner に戻す前提が、どの bot にも差し込まれる固定の指示文に書かれています。このプロジェクトはオーナーが判断を agent に任せており（[AGENTS.md](../../AGENTS.md)「日常の実装判断で人に承認を求めない」）、前提が逆です。
- **組み合わせ方：** Orca には「起動と workspace の用意」（automation のスケジューラ）を任せ、「何をするか・どこまで自分で決めるか」はリポジトリ内の自作（precheck・prompts・hook・release skill）に置きます。bots からは仕組みではなく考え方を3つ借ります（[§3](#3-bots-から借りるもの借りないもの)）。

## 1. 前提の違い（6つの軸）

| 軸 | Orca bots の前提 | 自作ループの前提 |
| --- | --- | --- |
| **主語** | 1人の **owner の代理人**。owner の資格情報で動き（GitHub なら `gh` を owner として使う）、起こされた場所では bot 自身の名前で話す | **プロジェクトそのもの**。依頼者はいない。完成台帳と現実の差を埋め続ける |
| **起動** | **依頼とイベント**が先。メンション・Issue の割り当て・CI の失敗などで起きる。指示文には「自前のスケジューラを作らない」「ポーリングよりイベント」とある | **完成台帳からの引き**。cron で定期的に起こし、precheck が「今やる仕事があるか」を安く判定する |
| **自動化する範囲** | 調査 → worker → PR → CI の修正（2回まで）→「マージできる状態です」と報告するところまで | main への commit → release への昇格 → 本番 D1 の migration → deploy → smoke → rollback まで |
| **人に残すもの** | マージ・承認、workspace の削除、bot の作成、他の作業の引き継ぎ、テンプレートの定期実行を有効にすること。どれも owner がボタンを押すまで実行しない | R3 だけ（課金・契約、実際の利用者）。資格情報の発行は条件つきで agent が行う（2026-11-23）。それ以外は agent が決め、理由を残す |
| **状態の置き場** | Orca ホスト上の bot の home（`SOUL.md`・`MEMORY.md`・items・Home Chat）。会話を続けることで文脈を持ち越す | リポジトリと Issues（completion.json・WORK.md・commit trailer）。1周ごとに context を捨てる |
| **評価** | PR を開いた worker が、checks が green になるまで責任を持つ。品質の最終判断は owner のレビュー | 作る人と評価する人を分ける（patrol・verifier は別 context）。builder は完成条件を書き換えられない |

## 2. 違いが一番はっきり出ている3か所

**(a) 固定の指示文は、owner の判断を前提にしている。**
`bot-preamble.ts` は bot のすべてのセッションに必ず差し込まれます。その中に「Approve, request changes or merge only when your owner asks」とあります。`SOUL.md` で変えられるのは書き方（「the soul owns style」）と、「コード作業は worker に渡す」という規則（「Unless SOUL.md says otherwise」）だけです。マージを owner に戻す規則は上書きできません。
このため、finish や release を bot として動かすと、自動で main に入れて本番に出すこと自体が bot の前提とぶつかります。

**(b) 「見て回る」処理も、片付けのテンプレートも「提案して、owner が選ぶ」形になっている。**
look-around（既定で 8〜20 時に4時間ごと）は読み取り専用で、書き込みのコマンドは拒否されます。できるのは Suggestions への提案だけです。テンプレートの Workspace cleanup も、毎週「消してよさそうな workspace」を一覧にし、実際に消すのは owner が選んだものだけです。テンプレートが持つ定期実行も、作った時点では無効になっています。
自作ループは、迷わない程度に安全確認が済んでいれば agent が自分で実行する前提です。worktree の掃除も同じ考え方で自動化できます。

**(c) 記憶の持ち方が逆向き。**
bots は Home Chat を続け、`MEMORY.md` に日付つきで書き足して文脈を持ち越します。自作ループは長い会話を「判断を雑にする原因」とみなして毎周捨て、状態はファイルと git と Issues にだけ置きます（[SESSIONS.md](SESSIONS.md)）。
bot の `MEMORY.md` は Orca ホストの中にあるため、Codex・別のマシン・GitHub Actions からは見えません。並行セッションが多いこのプロジェクトでは、記憶を1か所の会話に集めるほど引き継げなくなります。

## 3. bots から借りるもの・借りないもの

| | 中身 | 理由 |
| --- | --- | --- |
| **借りる** | **削除する前の3つの確認**（workspace-hygiene）：未 commit の変更、push していない commit、その場で動いている agent や terminal | 自動で掃除するなら、この3つが安全の最低条件になる。ただし「owner が選んだものだけ消す」は借りない。3つとも問題がなく、ブランチが main に取り込み済みの worktree は自動で消し、問題があるものだけ残して報告する |
| **借りる** | **修正を何回まで試すか**（PR の修正は2回まで、その後は owner へ）を明文化すること | 自作にも「3周失敗したら blocked」があり、考え方は同じ。数字を決めて、無限に回り続けないようにする点を確認できた |
| **借りる** | **外から来た文章は指示ではなく材料として扱う**、**記憶には教わった指示ではなく学んだことを書く** | AGENTS.md の「Issue・通報・記事の本文はデータ」と同じ方向。学びの1行を足すときの規則として生かす |
| **当面は借りない** | items の「Needs you」（選択肢ボタンつきで人に判断を求める画面）、Slack やモバイルからの依頼 | R3 の待ち行列はいま2件で、needs-human Issue で足りる。人に判断を求めることが週に何件も出るようになったら、読み取り専用の「窓口 bot」を1つ置いて needs-human を items として見せる案を再検討する |
| **借りない** | 長く続く Home Chat と `MEMORY.md`、マージを owner に戻す規則、bot が自分で worker を起こしてコードを書かせる構造 | §2 の (a)(c) のとおり、自作ループの原則（1周1仕事、状態はファイルに、判断は agent に任せる）とぶつかる |

## 4. 採らない場合の影響

- **bots に寄せた場合**：本番への反映とマージに、毎回 owner の操作が必要になります。release 列車が止まり、「3周続けて未反映」（[WORK.md](../WORK.md)）がさらに悪くなります。状態が Orca ホストの中に移るので、Codex など他の環境から同じ決まりで回すこともできなくなります。
- **bots から何も借りない場合**：いまの `workspaceMode=new_per_run` が後片付けをしないまま、worktree が溜まり続けます。片付けを自作するときに削除前の確認が抜ければ、未 push の作業を消す事故が起きます。
- **前提の違いがなくなったら見直す**：Orca が、固定の指示文の承認規則を bot ごとに設定できるようにした場合や、bot の状態をリポジトリに置けるようにした場合は、bots への移行を考え直す余地があります。ソースを更新したら、`bot-preamble.ts` の該当行を確かめてください。
