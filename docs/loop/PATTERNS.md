# ループ型の進め方：調査と採否

2026-11-21 調査。エージェントに開発を進めさせる「ループ」の考え方と、ブランチ・リリースの OSS 事例を集め、このプロジェクトで何を採り何を採らないかを決めた記録です。
採否の結論は [README](README.md) と [LOOPS.md](LOOPS.md) に反映済みです。

## 一覧

| # | パターン | 何を回すか | 採否 | このプロジェクトでの形 |
| --- | --- | --- | --- | --- |
| 1 | Ralph ループ | 同じ指示書を、まっさらなcontextで何度も | **採用（形を変えて）** | finish の「1周1仕事・状態はファイル」 |
| 2 | 初期化＋作業エージェント | 機能一覧の pass/fail を1件ずつ埋める | **採用** | completion.json |
| 3 | 計画・生成・評価の分離 | 生成と評価を別エージェントに | **採用** | patrol（評価）と builder（生成）の分離 |
| 4 | autoresearch（保持か破棄か） | 固定の評価器で測り、良くなった変更だけ残す | 一部採用 | 評価基準を builder が触れない／P0で列車停止 |
| 5 | evaluator-optimizer | 評価の指摘で作り直す | 採用 | patrol → Issue → finish |
| 6 | 自動UX監査 | ブラウザで歩いて採点・報告 | **採用** | patrol と ux-rubric.md |
| 7 | harness engineering（定期掃除） | 文書の陳腐化・逸脱を定期的に掃除 | **採用** | garden、短い AGENTS.md |
| 8 | compound engineering | 計画→作業→レビュー→学びの蓄積 | 一部採用 | 「学びを1行」だけ |
| 9 | spec-driven（Spec Kit） | 仕様→計画→タスク→実装 | 一部採用 | 台帳を仕様の代わりに。機能ごとの仕様書は作らない |
| 10 | アンドン／自働化 | 異常で止めて直す | **採用** | mend |
| 11 | エラーバジェット | 信頼性の予算が尽きたら機能より修理 | 一部採用 | open P0 がある間は列車停止 |
| 12 | Shape Up のサーキットブレーカー | 期限内に終わらなければ打ち切る | 採用 | 3周失敗で blocked |
| 13 | 人による価値検証・較正 | 人の判断で評価基準を育てる | **採用** | value ループ |
| 14 | ブランチ・リリース方式 | trunk / 列車 / git-flow | trunk＋release 列車 | README §5、RELEASE.md |
| 15 | セッション分割・並行 | worktree・orchestrator-workers | 採用 | SESSIONS.md |

---

## A. 完成まで進め続けるループ

### 1. Ralph ループ（Geoffrey Huntley, 2025-07）

`while :; do cat PROMPT.md | claude ; done` という素朴なbashループ。毎周まっさらなcontextで同じ指示書を読み、計画ファイル（`IMPLEMENTATION_PLAN.md`）から1件選んで実装・テスト・commitし、終わる。記憶はモデルではなくgitとファイルに置く。

- **核の考え方**：「1周に1件」（Huntleyは繰り返し強調）。contextを小さく使うほど賢く動く。
- **backpressure**：テスト・型・lint・buildが「悪い生成を押し返す」舵になる。検査が遅いと周回数が減るので、速さが重要。
- **計画は使い捨て**：ずれたら計画を捨てて planning モードで作り直す。作り直しは1周分のコストで、迷走より安い。
- **既知の失敗**：「まだ実装されていない」と早合点して重複実装する／仮実装（placeholder）に寄る／既存コードの悪いパターンを真似る。
- **限界**：Huntley自身、新規開発で9割まで行くのに向き、既存コードベースには懐疑的と述べている。安全境界はサンドボックスだけになる。

**採ったもの**：1周1仕事、状態はファイルとgit、backpressure、計画の作り直し（replan）、重複実装と仮実装への明示的なガード（prompts/finish.md）。
**採らなかったもの**：1枚の計画ファイルを共有の待ち行列にすること。並行セッションが同じファイルに書くと衝突するため、待ち行列は GitHub Issues にした。

### 2. 初期化エージェント＋作業エージェント（Anthropic, 2025-11）

最初のセッションだけが環境（`init.sh`、進捗ファイル、200件超の機能一覧 `feature_list.json`、初回commit）を作り、以降のセッションは一覧から未達の1件を選んで進める。

- 機能一覧は **JSON**。Markdownより「モデルが不適切に書き換えにくい」ため。作業エージェントは `passes` 欄だけを変えてよく、項目の削除・編集は許されない。
- 各セッションの開始時に `pwd`・進捗ファイル・git log を読み、基本的なE2E確認をしてから新しい仕事に入る。
- 観察された失敗：一気に作ろうとして途中でcontextが尽きる／進捗を見て「全部終わった」と早合点する／E2Eで確かめずに完了にする。
- ブラウザ自動操作で「人間の利用者のように」確かめさせると、単体テストやcurlだけより格段に良くなった。

**採ったもの**：completion.json（JSON・builderは status/evidence だけ変更可）、セッション開始の型（SESSIONS.md）、R1以上でのブラウザ確認。

### 3. 計画・生成・評価の分離（Anthropic, 2026-03）

planner が1〜4文の依頼を野心的な仕様に広げ、generator が作り、evaluator が Playwright で実際に操作して採点する。GANのように生成と評価を分ける。

- **自己評価の甘さ**：「エージェントは自分の仕事を確実に甘く採点する」。評価役も素の状態では問題を見つけても「大したことはない」と自分を説得して合格にした。著者は評価役のログを自分の判断と突き合わせて、数回プロンプトを調整した。
- **採点**：観点ごとに閾値を置き、1つでも下回れば不合格。総合点では丸めない。
- **コスト**：単独実行20分・9ドルに対し、フルハーネスは6時間・200ドル。モデルが強くなるにつれて、スプリント分割をやめ評価を最後に1回へ簡素化した。「評価役は、課題が現行モデル単独で確実にこなせる範囲を超えるときに元が取れる」。

**採ったもの**：評価役（patrol）を作る役と別contextに、観点ごとの閾値で合否、人による較正（value ループ）。
**採らなかったもの**：スプリントごとに生成役と評価役が「完了の契約」を交渉する仕組み。Issue の受け入れ条件と completion.json の acceptance で代わりになり、交渉の往復コストが要らない。

### 4. autoresearch（Andrej Karpathy, 2026）

人は `program.md`（方針）だけを書き、エージェントは `train.py` だけを変える。評価器 `prepare.py` はどちらも触らない。5分の固定予算で実験し、指標（val_bpb）が良くなった commit だけ残し、悪ければ git で戻す。結果は `results.tsv` に記録し、止まらずに回し続ける（ある報告では126実験中23件を採用）。

**採ったもの**：「評価基準は作る役が触れない」（ux-rubric.md と completion.json の acceptance は builder が変更不可）。「悪くなったら戻す」（mend の revert、release の rollback）。
**採らなかったもの**：単一のスカラー指標での自動採否。UX の良し悪しは1つの数字にならず、数字に寄せると重大な1件が埋もれる。数値化できる部分（axe違反数、LCP）だけを観点に入れた。

### 5. 道具立て（Claude Code / Codex / Orca）

- Claude Code の Stop hook を使った Ralph 化（公式プラグイン、2025-12）、`/loop`、スケジュール実行。
- Orca の automation（cron＋precheck：precheck が成功したときだけエージェントを起こす）。無駄な起動と課金を防げるので、このプロジェクトの全ループは precheck つきで登録する（loop-infra が実装）。

---

## B. 体験の悪いところを見つけて直すループ

### 6. evaluator-optimizer（Anthropic "Building effective agents", 2024-12）

1つのLLMが生成し、別のLLMが評価とフィードバックを返すループ。評価基準が明確で、反復で改善が見込めるときに効く。

### 7. 自動UX監査ツール群

ブラウザで課題を実行し、手順ごとに分かりやすさ・効率を採点する Avenir-UX、Nielsen の10ヒューリスティクスで採点する監査、スクリーンショット→批評→修正を回す `ui-preview-loop` skill など。共通する教訓：

- 監査（見つける）は得意だが、直して再確認する部分の信頼性は報告が少ない。
- 決定的な検査（axe等）とモデルの目視を組み合わせる方が、どちらか単独より良い。
- 反復回数に上限を置き、未解決は報告に回す。指定外の「ついで修正」をしない。

**採ったもの**：patrol は見つけるだけ、直すのは builder（役割を分けると、上限と責任がはっきりする）。axe＋目視の併用、所見数の上限、1所見1Issue。

### 8. Nielsen のヒューリスティック評価（1994〜）

専門家が10の原則（状態の可視化、現実との一致、エラー防止、など）で画面を点検する古典的手法。ux-rubric.md の観点（次の一手、言葉、見える化、失わない）はここから、このサービスの目的に合わせて選び直した。

---

## C. 品質と秩序を保つループ

### 9. harness engineering（OpenAI, 2026-02）

3人のエンジニアがCodexを動かし、約5か月で約100万行・約1,500件のPRを作った事例（数字は二次資料による。原文は取得時に403で読めず、要約記事で確認）。

- 当初は1つの大きな AGENTS.md が予想どおりに破綻し、約100行の「地図（目次）」にして、詳細は構造化した `docs/` に置いた。
- エージェントは既存の（悪い）パターンまで真似るため、「黄金律」を機械的なルールとしてリポジトリに書き、定期的に逸脱を探して修正PRを出すバックグラウンドタスク（doc-gardening、品質グレードの更新）を回した。それ以前は毎週金曜（週の2割）を「AIの散らかり」の掃除に使っていた。

**採ったもの**：garden ループ、AGENTS.md を短い地図にする、docs/ の整理。

### 10. compound engineering（Every）

計画→作業→レビュー→**compound**（学びを保存して次回使う）のループ。労力の約8割を計画とレビューに置く。

**採ったもの**：「次の周回が同じ失敗をしないための1行」を AGENTS.md か prompts に足す。
**採らなかったもの**：学びの専用フォルダ（docs/solutions/ 等）。文書を増やさない方針と衝突し、増えた学びを誰も読まなくなるため。

### 11. spec-driven development（GitHub Spec Kit, 2025-09）

constitution（原則）→ spec → plan → tasks → implement。仕様を先に固めて実装のぶれを防ぐ。

**採ったもの**：「完成の定義を先に置く」こと自体（completion.json）、AGENTS.md の恒久条件を constitution として扱うこと。
**採らなかったもの**：機能ごとの仕様書・計画書の作成。このプロジェクトはすでに機能ごとの設計メモが約60、QA文書が約60あり、文書の過剰が遅さの原因だった。

### 12. アンドン（トヨタ生産方式）・エラーバジェット（Google SRE）・サーキットブレーカー（Shape Up）

- アンドン：異常を見つけたらラインを止めて直す → **mend**（main が赤なら最優先）。
- エラーバジェット：信頼性の予算を使い切ったら機能開発より信頼性に振る → **open な P0 がある間は release 列車が止まる**。
- サーキットブレーカー：決めた時間で終わらない仕事は延長せず打ち切って形を変える → **3周失敗で blocked、replan で分け直す**。

---

## D. 人が主役のループ

### 13. 価値検証と較正

AIの巡回は「動くか・迷うか」は見つけられるが、「学生の次の行動につながるか」は確かめられない。また、評価役の採点は人の判断と突き合わせて調整しないと甘くなる（#3）。

**採ったもの**：value ループ（人がブラインドで採点し直して rubric を直す較正、完成後の学生による検証、定時のレビュー）。

---

## E. ブランチとリリース

| 事例 | 形 | 学んだこと |
| --- | --- | --- |
| Rust | main（nightly）→ beta → stable の6週間列車。修正は main に入れて beta へ backport。未完成機能は feature flag で nightly だけ | 開発の速さと出荷の安全をブランチで分ける。出荷は時刻表で |
| Chromium | main で開発し、約2週間ごとに選んだ地点を切って安定化 → stable。stable を止める問題は切る前に直す | 「止める条件」を明確にした定期出荷 |
| Kubernetes | master と release-X.Y。年3回、コードフリーズ後は重要修正だけ、master から cherry-pick | 版の並行保守が要るソフト向け。Webサービスには重い |
| trunk-based development | 単一の trunk。高頻度なら trunk から直接、低頻度なら直前に release ブランチを切る。修正は trunk で直してから cherry-pick | 修正は必ず trunk 先 |
| git-flow / GitHub flow | git-flow は develop・feature・release・hotfix の長命ブランチ。作者は2020年に「継続的デリバリーのWebアプリならより単純な方式を」と注記 | 長命ブランチは衝突を後ろに溜める |

**結論**：main＝trunk に全員が直接統合し、選んだSHAを `release` に fast-forward で昇格させる列車方式。CIは昇格時だけ必須。詳細は README §5 と [RELEASE.md](../RELEASE.md)。

---

## F. セッションの分割と並行

- **orchestrator-workers**（Anthropic "Building effective agents"）：中央の役が仕事を分けて workers に渡し、結果をまとめる → conductor と builder。
- **git worktree での並行**：セッションごとに worktree を分ければファイルの衝突は防げるが、同じファイルの編集は後で必ずぶつかる。実践者の報告では、並行数が3〜4を超えると調整のコストが利得を上回る → builder は最大3、領域（area）で分ける。
- **subagent と並行セッションの使い分け**：短い調べもの・読み込みは subagent、長く独立した仕事は別 worktree のセッション。Ralph の運用では、読む作業は多数の subagent に広げ、build/test は1つに絞る（並列で build すると backpressure が乱れる）。
- **context reset と compaction**：Anthropic は、古いモデルでは「contextの残りを気にして早く切り上げる」傾向があり reset が必要だったが、新しいモデルでは自動 compaction で1つの長いセッションを回せたと報告している。このプロジェクトでは、Issue が小さく引き継ぎがIssueに残るので、builder は1件ごとに reset する（要約に前の仕事の思い込みを持ち込ませないため）。conductor のような全体を見る役は長めに保つ。

---

## 出典

- Geoffrey Huntley, [Ralph Wiggum as a "software engineer"](https://ghuntley.com/ralph/)（2025-07-14）、Clayton Farr, [The Ralph Playbook](https://claytonfarr.github.io/ralph-playbook)
- Anthropic, [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)（2025-11-26）
- Anthropic, [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)（2026-03-24）
- Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)（2024-12）
- OpenAI, [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/)（2026-02。本文は取得できず、[要約1](https://yage.ai/share/harness-engineering-survey-en-20260312.html)・[要約2](https://www.swequiz.com/articles/openai-harness-engineering) で確認）
- Karpathy autoresearch の解説：[DataCamp](https://www.datacamp.com/tutorial/guide-to-autoresearch)、[freeCodeCamp](https://www.freecodecamp.org/news/build-an-ai-agent-that-runs-its-own-llm-experiments-with-autoresearch/)
- Every, [Compound engineering](https://every.to/guides/compound-engineering)、[plugin](https://github.com/EveryInc/compound-engineering-plugin)
- GitHub, [Spec Kit](https://github.github.com/spec-kit/)
- UX監査：[Avenir-UX](https://github.com/Onflow-AI/Avenir-UX)、[ui-preview-loop skill](https://raw.githubusercontent.com/Ludenox-GIT/portable-agent-skills/main/skills/ui-preview-loop/SKILL.md)
- リリース：[Rust の列車モデル](https://doc.rust-lang.org/book/appendix-07-nightly-rust.html)、[Chromium release cycle](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/process/release_cycle.md)、[Kubernetes release cycle](https://kubernetes.io/releases/release/)、[trunkbaseddevelopment.com: branch for release](https://trunkbaseddevelopment.com/branch-for-release/)、[release from trunk](https://trunkbaseddevelopment.com/release-from-trunk/)、[A successful Git branching model（2020年の注記）](https://nvie.com/posts/a-successful-git-branching-model/)
- 並行セッション：[Claude Code と git worktree の実践報告](https://dev.to/sahil_kat/how-to-keep-parallel-coding-agents-from-stepping-on-each-other-e5g) ほか
