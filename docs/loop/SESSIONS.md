# セッションの分け方

エージェントのセッション（1つの会話context）をどう分け、どう並べ、どう引き継ぐか。

## 分ける理由は3つだけ

セッションを分けるのは役職を真似るためではありません。分ける理由は次の3つに限ります。

1. **contextを守る**：1つのcontextに詰め込むほど、序盤の指示を忘れ、判断が雑になる。1つの仕事が終わったらcontextを捨てる（Ralph の「1周ごとにまっさらなcontext」、Anthropic の context reset）。
2. **評価を独立させる**：作った本人は自分の成果を甘く採点する。評価するcontextは、作業のやり取りを見ていない必要がある。
3. **書き込み先を分けて並行させる**：同じファイルを2つのセッションが同時に書くと衝突する。並行させるなら、触る場所で分ける。

この3つのどれにも当たらない分割はしません。分けるたびに引き継ぎのコストと「誰が何を知っているか」の混乱が増えるからです。

## 常駐レーンと使い捨てセッション

| 種類 | 名前 | 寿命 | 書いてよい場所 | 回すループ |
| --- | --- | --- | --- | --- |
| 常駐 | **conductor** | 長い（日単位） | docs/WORK.md、docs/loop/、completion.json、Issues | replan、人への報告 |
| 常駐 | **builder** ×1〜3 | 周回ごとに context を捨てる（`/clear` か新セッション） | claim した Issue の範囲の src/ worker/ tests/ migrations/ | finish |
| 常駐 | **infra** | 長い | .github/、scripts/、.claude/、docs/RELEASE.md、ruleset | release |
| 使い捨て | **patrol** | 1回の巡回で終わる | Issues のみ（コードは読むだけ） | patrol |
| 使い捨て | **garden** | 1回で終わる | docs/、不要コードの削除 | garden |
| 使い捨て | **verifier** | 1件の検証で終わる | Issue コメントのみ | R2 の独立検証 |

2026-11-21 時点の対応：`loop-design`（このセッション）＝conductor の初期化、`loop-infra`＝infra、`app-dev`＝builder。

**conductor はアプリのコードを書かない。** 全体を見る役が実装に入ると、目の前の1件に context を使い切り、待ち行列と完成台帳を見る人がいなくなるためです。

### builder の数は最大3

automation の precheck は `claimed` の Issue が3件以上あると finish を起動しない（上限は環境変数 `KSH_MAX_BUILDERS` で変更）。

並行数を増やすほど速くなるわけではありません。経験的に、1つのリポジトリで並行エージェントが3〜4を超えると、衝突の解消と調整のコストが利得を上回ります。さらにこのプロジェクトは `src/main.tsx` など共有度の高いファイルがあり、同じ場所に集まりやすい。まず2で回し、衝突が少なければ3にします。

## 並行作業の衝突回避

- **worktree を分ける**：セッションごとに1つの git worktree（Orca workspace）。同じ作業ディレクトリを2セッションで使わない。
- **領域で分ける**：builder 同士は claim した Issue の領域が重ならないように選ぶ。replan は Issue に `area:` を書き（例 `area: editor` `area: discovery` `area: auth`）、builder は他人が claim 中の area を避ける。
- **小さく頻繁に main へ**：1 Issue＝1〜数 commit。push 前に `git fetch && git rebase origin/main`。数時間抱えた変更は衝突の元。
- **共有ファイルの変更は先に知らせる**：`src/style.css` のトークン、`src/main.tsx` のルーティング、`worker/index.ts`、`migrations/` の番号、`package.json` は、触る前に他の常駐セッションへ一言送る（SendMessage）。migration 番号は push の直前に取り直す。
- **stash を使わない**：git stash はworktree間で共有されるため、他セッションの退避を壊す。一時退避は WIP commit で。
- **force push しない**：main・release とも禁止（hook で拒否）。rebase は自分のローカルだけで行う。

## 引き継ぎ：会話ではなく、ファイルとIssueで

セッション同士の SendMessage は「いまこのファイルを触る」「この方針でよいか」のような調整にだけ使います。決まったこと・残っている仕事は、必ずリポジトリかIssueに残します。会話は次のセッションから見えないからです。

| 何を | どこに |
| --- | --- |
| 何ができたら完成か | completion.json |
| 次にやること・着手中 | Issues（`claimed` とコメント） |
| いまどこにいるか（5行） | docs/WORK.md |
| なぜそう決めたか | docs/DECISIONS.md（プロダクト）、docs/loop/（進め方） |
| 同じ失敗を繰り返さないための1行 | AGENTS.md または prompts/*.md |
| 何を変えたか | commit（`Loop:` `Risk:` trailer） |

### セッション開始の型（全セッション共通）

1. `pwd` と `git status` で自分の worktree を確認
2. `git fetch && git rebase origin/main`
3. AGENTS.md → docs/loop/README.md → 自分の役の prompt を読む
4. docs/WORK.md と、自分の待ち行列の Issue を確認
5. 自分が前回 claim したまま残っている Issue があれば、先にそれを片付けるか claim を外す

### context を捨てるタイミング

- builder：Issue を1件閉じたら必ず。長い会話の要約（compaction）で2件目に進まない。要約は細部を落とし、前の仕事の思い込みを次へ持ち込むため。
- conductor：1日に1回、またはレビュー報告を出した後に新セッションへ。引き継ぎは WORK.md と Issues で足りるようにしておく。

## 独立検証の頼み方

R2（境界に触る）変更は、作ったセッションとは別の verifier に検証させます。

1. builder は Issue に「検証してほしいこと」を3〜5行で書く：変えたファイル、守るべき境界（例：他人の下書きを読めない、学校メールが公開APIに出ない）、試してほしい攻め方。
2. 新しいセッション（または Agent tool の別context、Codex）を verifier として起動し、その Issue 番号だけを渡す。builder の会話は渡さない。
3. verifier は main の該当SHAで実際に動かして確かめ、結果を Issue にコメントする（合否・実行したコマンド・見つけた問題）。QA文書は作らない。
4. 問題があれば builder が直し、同じ verifier ではなく新しい verifier で再確認する。

## 並行セッションの名前と連絡

Orca の session 名（例 `loop-infra-35`）で SendMessage を送れます。相手が忙しいときは返事を待たず、自分の判断で進めて、決めたことを Issue か docs に残してください。20分以内に異論がなければ合意とみなす、という運用で十分です。
