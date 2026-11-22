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
  const install = [
    'mkdir -p ~/.claude/skills/ksh-article/scripts',
    `curl -fsSL ${kit}/SKILL.md -o ~/.claude/skills/ksh-article/SKILL.md`,
    `curl -fsSL ${kit}/scripts/session_index.py -o ~/.claude/skills/ksh-article/scripts/session_index.py`,
  ].join('\n');
  return (
    <article className="shell about prose agents-page">
      <p className="kicker">YOUR AGENT × KOBE STUDENT HUB</p>
      <h1>自分のAIエージェントと使う</h1>
      <p className="agents-lead">
        Claude Code・Codex・ChatGPT・Gemini・Antigravity
        など、ふだん使っているAIエージェントで記事を書いたり、記事を読み解いたりできます。
        AIとの作業履歴は、そのまま記事の材料になります。
      </p>

      <nav className="agents-toc" aria-label="このページの内容">
        {AGENT_MCP_RELEASE_ENABLED && <a href="#connect">AIとつなぐ（MCP）</a>}
        <a href="#write-from-history">作業履歴から書く</a>
        <a href="#write-in-editor">下書き画面で書く</a>
        <a href="#read">記事をAIと読む</a>
        <a href="#format">ファイルの形</a>
        <a href="#safety">情報の扱い</a>
      </nav>

      {AGENT_MCP_RELEASE_ENABLED && (
        <section>
          <h2 id="connect">AIエージェントとつなぐ（MCP）</h2>
          <p>
            つなぐと、AIエージェントがあなたの下書きを直接作れます。作られた下書きは非公開のままで、
            <Link to="/drafts">下書き</Link>
            で読んで直し、自分で公開します。最初の1回だけ、学校Googleでログインして「接続を許可」を押します。
          </p>
          <CopyBlock label="MCP サーバーの URL" text={`${origin}/api/mcp`} />
          <ul>
            <li>
              Claude Code：<code>claude mcp add --transport http ksh {origin}/api/mcp</code> のあと{' '}
              <code>/mcp</code> でログイン
            </li>
            <li>Claude（claude.ai）：設定 → コネクタ → カスタムコネクタを追加 → 上の URL</li>
            <li>
              Codex CLI：<code>codex mcp add ksh --url {origin}/api/mcp</code> のあと{' '}
              <code>codex mcp login ksh</code>
            </li>
            <li>
              Gemini CLI：<code>gemini mcp add --transport http ksh {origin}/api/mcp</code> のあと{' '}
              <code>/mcp auth ksh</code>
            </li>
          </ul>
          <p>
            エージェントにできるのは、公開記事を読むことと、あなたの下書きを作る・直すことだけです（公開・削除はできません。作成は1日10件まで）。
            毎日決まった時間に書かせる設定例は{' '}
            <a href="/agent-kit/ksh-article/SKILL.md">SKILL.md</a> にあります。接続は
            <Link to="/account">マイページ</Link>でいつでも解除できます。
          </p>
        </section>
      )}

      <section>
        <h2 id="write-from-history">AIとの作業履歴から記事を書く</h2>
        <p>
          エラーを直した、技術を選んだ、初めてのツールで詰まった——AIエージェントとの作業履歴には、後輩が知りたい経験が残っています。
          執筆キットを読んだエージェントが、あなたのコンピュータの中の履歴から記事のネタを3〜5個探し、あなたに質問してから下書きファイルを作ります。
        </p>
        <h3>いちばん簡単な方法：エージェントにこう頼む</h3>
        <p>
          ファイルを読めるエージェント（Claude Code・Codex・Antigravity
          など）に、そのまま貼ってください。
        </p>
        <CopyBlock label="エージェントへの依頼文" text={ask} />
        <h3>Claude Code にスキルとして入れる</h3>
        <p>入れておくと「hub に記事を書きたい」「最近の作業を記事にして」と頼むだけで使えます。</p>
        <CopyBlock label="スキルを入れるコマンド" text={install} />
        <p className="agents-files">
          キットの中身：
          <a href="/agent-kit/ksh-article/SKILL.md">SKILL.md（手順）</a>・
          <a href="/agent-kit/ksh-article/scripts/session_index.py">
            session_index.py（履歴の一覧・要約）
          </a>
        </p>
      </section>

      <section>
        <h2 id="write-in-editor">下書き画面でAIと書く</h2>
        <ol>
          <li>
            <Link to="/drafts">下書き</Link>
            で新しい下書きを開き、「自分のAIエージェントと書く」を開きます。
          </li>
          <li>
            「依頼文をコピー」を押して、自分のAIに貼ります。いまの下書きと、記事の形・守ることが入っています。
          </li>
          <li>
            AIが書いたファイルを貼るか、.md
            ファイルを選んで「内容を確認」→「下書きに反映」。概要・タグなどは「公開の準備」で入れられます。
          </li>
          <li>プレビューで読み、自分の経験と違うところを直してから公開します。</li>
        </ol>
      </section>

      <section>
        <h2 id="read">記事をAIと読む</h2>
        <p>
          記事ページの下にある「AIに渡す」で、記事を出典つきの Markdown
          としてコピーできます。自分のAIに貼って「前提知識を説明して」「自分のプロジェクトで試す手順にして」と聞いてみてください。
        </p>
      </section>

      <section>
        <h2 id="format">ファイルの形</h2>
        <p>
          先頭の <code>---</code>{' '}
          で囲んだ部分に、タイトルと読者向けの情報を書きます。キーは日本語（タイトル・概要・タグ・想定読者・前提知識・読んだあとに・読了時間）でも読めます。
        </p>
        <CopyBlock label="記事ファイルの例" text={ARTICLE_FORMAT_EXAMPLE} />
      </section>

      <section>
        <h2 id="safety">情報の扱い</h2>
        <ul>
          <li>
            作業履歴を読むのは、あなたのコンピュータの中のエージェントです。このサイトが履歴を受け取ることはありません。
          </li>
          <li>
            AIが投稿することはありません。下書きに反映して保存し、公開するのはいつもあなた自身の操作です。
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
      </section>
    </article>
  );
}
