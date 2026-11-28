import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ARTICLE_FORMAT_EXAMPLE } from './article-format';
import CopyButton from '../shared/CopyButton';
import { AGENT_MCP_RELEASE_ENABLED } from '../shared/agent-release';
import './agent.css';
import './agents-page.css';

function CopyBlock({ label, text }: { label: string; text: string }) {
  const block = useRef<HTMLPreElement>(null);
  return (
    <div className="agents-copy">
      <pre ref={block} tabIndex={0} aria-label={label}>
        <code>{text}</code>
      </pre>
      <CopyButton
        className="agents-copy-button"
        label={label + 'をコピー'}
        text={() => text}
        onFailed={() => {
          const node = block.current;
          if (!node) return;
          getSelection()?.selectAllChildren(node);
          node.focus();
        }}
      />
    </div>
  );
}

/** "AIエージェントと使う": how a student's own agent can write and read with this site. */
export default function AgentsPage() {
  const origin = window.location.origin;
  const kit = `${origin}/agent-kit/ksh-article`;
  const ask = `${kit}/SKILL.md を読んで、その手順どおりに、私の最近の作業履歴から Kobe Student Hub の記事の下書きを作ってください。投稿はせず、ファイルを作るところまでにしてください。`;
  const install = `${kit}/SKILL.md と ${kit}/scripts/session_index.py を読んで、中身を私に説明してから、Claude Code のスキル ksh-article として ~/.claude/skills/ksh-article に置いてください。`;
  return (
    <article className="shell about prose agents-page">
      <h1>自分のAIエージェントと使う</h1>
      <p className="agents-lead">
        Claude Code・Codex・ChatGPT・Gemini
        など、ふだん使っているAIで記事の下書きを作れます。公開するのはいつもあなたです。
      </p>
      <p className="agents-start">
        <Link className="primary" to="/drafts">
          下書きを開く
        </Link>
        <span>
          下書き画面の「自分のAIエージェントと書く」から、AIに渡す依頼文をコピーできます。
        </span>
      </p>

      {AGENT_MCP_RELEASE_ENABLED && (
        <section>
          <h2 id="connect">AIとつなぐ（MCP）</h2>
          <p>
            このURLを自分のAIに登録すると、AIがあなたの下書きを直接作れます。作られた下書きは非公開のままです。
          </p>
          <CopyBlock label="MCP サーバーの URL" text={`${origin}/api/mcp`} />
          <details className="agents-more">
            <summary>AIごとの登録方法と、AIにできること</summary>
            <ul>
              <li>
                Claude（claude.ai・デスクトップアプリ）：設定 → コネクタ →
                カスタムコネクタを追加（またはプラグイン → 追加 → カスタムコネクタを追加）→ 上の
                URL。2026-11-28 に本番で接続と下書きの作成を確かめました
              </li>
              <li>
                Claude Code：claude.ai に足したコネクタが、同じアカウントでログインした Claude Code
                にもそのまま出ます。2026-11-28 に確かめました
              </li>
            </ul>
            <p>次は登録方法だけの案内で、本番での接続はまだ確かめていません。</p>
            <ul>
              <li>
                Codex CLI：<code>codex mcp add ksh --url {origin}/api/mcp</code> のあと{' '}
                <code>codex mcp login ksh</code>
              </li>
            </ul>
            <p>
              最初の1回だけ、学校Googleでログインして「接続を許可」を押します。
              エージェントにできるのは、公開記事を読むこと、あなたの記事と作品の下書きを作る・直すこと、公開済みの記事を公開したまま直すことだけです（初めての公開・削除と、公開済みの作品を直すことはできません。作成は記事・作品それぞれ1日10件まで）。
              毎日決まった時間に書かせる設定例は{' '}
              <a href="/agent-kit/ksh-article/SKILL.md">SKILL.md</a> にあります。接続は
              <Link to="/account">マイページ</Link>でいつでも解除できます。
            </p>
          </details>
        </section>
      )}

      <section>
        <h2 id="write-in-editor">下書き画面でAIと書く</h2>
        <ol>
          <li>
            <Link to="/drafts">下書き</Link>
            で下書きを開き、「自分のAIエージェントと書く」を開きます。
          </li>
          <li>「依頼文をコピー」を押して、自分のAIに貼ります。</li>
          <li>
            AIが書いたファイルを貼るか選んで「内容を確認」→「下書きに反映」。概要・タグなどは、下書き画面の右上の「公開する」を押すと入れられます。
          </li>
          <li>プレビューで読み、自分の経験と違うところを直してから公開します。</li>
        </ol>
      </section>

      <section>
        <h2 id="write-from-history">AIとの作業履歴から書く</h2>
        <p>
          ファイルを読めるAI（Claude Code・Codex
          など）が、あなたのコンピュータの中の作業履歴から記事のネタを探し、質問してから下書きファイルを作ります。
        </p>
        <div className="agents-caution" role="note" aria-labelledby="history-caution">
          <h3 id="history-caution">履歴を使う前に</h3>
          <ol>
            <li>
              過去の作業履歴を参照すると、その中身があなたのAIエージェントと、その提供元のサービスに渡ります。
            </li>
            <li>
              履歴には、パスワード・APIキー・秘密鍵・メール・他の人の情報などが含まれることがあります。
            </li>
            <li>執筆キットの伏せ字は完全ではなく、すり抜けがあります。</li>
            <li>
              参照するかどうか、記事に何を載せるかはあなたが決めます。公開前に全文を読んでください。
            </li>
          </ol>
        </div>
        <CopyBlock label="エージェントへの依頼文" text={ask} />
        <details className="agents-more">
          <summary>Claude Code にスキルとして入れる</summary>
          <p>
            入れておくと「hub に記事を書きたい」「最近の作業を記事にして」と頼むだけで使えます。
          </p>
          <CopyBlock label="スキルを入れる依頼文" text={install} />
          <p className="agents-files">
            キットの中身：
            <a href="/agent-kit/ksh-article/SKILL.md">SKILL.md（手順）</a>・
            <a href="/agent-kit/ksh-article/scripts/session_index.py">
              session_index.py（履歴の一覧・要約）
            </a>
          </p>
        </details>
      </section>

      <section>
        <h2 id="read">記事をAIと読む</h2>
        <p>
          記事ページの下の「AIに渡す」で、記事を出典つきでコピーできます。自分のAIに貼って「前提知識を説明して」と聞いてみてください。
        </p>
      </section>

      <details className="agents-more">
        <summary id="format">記事ファイルの形</summary>
        <p>
          先頭の <code>---</code>{' '}
          で囲んだ部分に、タイトルと読者向けの情報を書きます。キーは日本語（タイトル・概要・タグ・想定読者・前提知識・読んだあとに・読了時間）でも読めます。
        </p>
        <CopyBlock label="記事ファイルの例" text={ARTICLE_FORMAT_EXAMPLE} />
      </details>

      <details className="agents-more">
        <summary id="safety">情報の扱い</summary>
        <ul>
          <li>
            作業履歴を読むのは、あなたのコンピュータの中のエージェントです。このサイトが履歴を受け取ることはありません。
          </li>
          <li>
            AIが記事を初めて公開することはありません。下書きに反映して保存し、公開するのはいつもあなた自身の操作です（接続したエージェントは、公開済みの記事を公開したまま直せます）。
          </li>
          <li>
            AIに渡した文章の扱いは、使っているAIサービスの規約に従います。
            パスワード・APIキー・他の人の名前などが混ざっていないか、公開前に必ず読んで確かめてください。
          </li>
          <li>
            AIを使って書いた記事も、内容の責任は書いた本人にあります（
            <Link to="/guide#rules">利用ルール</Link>）。
          </li>
        </ul>
      </details>
    </article>
  );
}
