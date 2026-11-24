import { useId, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import {
  buildWritingRequest,
  hasMetadata,
  parseAgentArticle,
  type AgentArticle,
} from './article-format';
import { copyText } from './clipboard';
import Icon from '../shared/Icon';
import './agent.css';

const MAX_FILE_BYTES = 512 * 1024;

/**
 * "AIエージェントと書く": hand the draft to the student's own agent and take its file back.
 * Everything stays in this browser until the student applies it to the draft, and the
 * existing draft save is still the only thing that writes to the server.
 */
export default function AgentWritingPanel({
  current,
  disabled,
  onApply,
  canUndo,
  onUndo,
}: {
  current: { title: string; body: string };
  disabled: boolean;
  onApply: (article: AgentArticle) => void;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const id = useId();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [manualText, setManualText] = useState('');
  const [source, setSource] = useState('');
  const [checked, setChecked] = useState<AgentArticle | null>(null);
  const [fileProblem, setFileProblem] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  async function copyRequest() {
    const text = buildWritingRequest(current, window.location.origin);
    if (await copyText(text)) {
      setCopyState('copied');
    } else {
      setManualText(text);
      setCopyState('manual');
    }
  }

  async function readFile(file: File | undefined) {
    setFileProblem('');
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileProblem('512KB以下の Markdown ファイルを選んでください。');
      return;
    }
    try {
      const text = await file.text();
      setSource(text);
      setChecked(parseAgentArticle(text));
    } catch {
      setFileProblem('ファイルを読み込めませんでした。中身をコピーして貼り付けてください。');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <details className="agent-panel">
      <summary>
        <span className="agent-panel-mark" aria-hidden="true">
          ✦
        </span>
        自分のAIエージェントと書く
        <small>Claude・ChatGPT・Codex・Gemini など</small>
      </summary>
      <div className="agent-panel-body">
        <ol className="agent-steps">
          <li>
            <h3>依頼文をコピーして、自分のAIに貼る</h3>
            <p>
              記事の形・守ること（個人情報や秘密を書かない など）と、いまの下書きが入っています。
              <a href="/agents" target="_blank" rel="noopener">
                過去のAIとの作業履歴から書く方法 ↗
              </a>
            </p>
            <Button className="agent-button" disabled={disabled} onClick={() => void copyRequest()}>
              <Icon name={copyState === 'copied' ? 'check' : 'copy'} size={18} />
              依頼文をコピー
            </Button>
            <span className="sr-only" role="status">
              {copyState === 'copied' ? 'コピーしました' : ''}
            </span>
            {copyState === 'manual' && (
              <>
                <label className="agent-label" htmlFor={id + '-manual'}>
                  自動でコピーできませんでした。下の文を選んでコピーしてください。
                </label>
                <textarea
                  id={id + '-manual'}
                  className="agent-textarea"
                  readOnly
                  value={manualText}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </>
            )}
          </li>
          <li>
            <h3>AIが書いたファイルを読み込む</h3>
            <p>AIの出力（--- で始まる Markdown）を貼るか、.md ファイルを選んでください。</p>
            <label className="agent-label" htmlFor={id + '-source'}>
              AIの出力
            </label>
            <textarea
              id={id + '-source'}
              className="agent-textarea"
              disabled={disabled}
              value={source}
              placeholder={'---\ntitle: …\nsummary: …\n---\n\n## 本文'}
              onChange={(event) => {
                setSource(event.target.value);
                setChecked(null);
              }}
            />
            <div className="agent-row">
              <Button
                className="agent-button"
                disabled={disabled || !source.trim()}
                onClick={() => setChecked(parseAgentArticle(source))}
              >
                内容を確認
              </Button>
              <label className="agent-file">
                <input
                  ref={fileInput}
                  type="file"
                  accept=".md,.markdown,.txt,text/markdown,text/plain"
                  disabled={disabled}
                  onChange={(event) => void readFile(event.target.files?.[0])}
                />
                <span>.md ファイルを選ぶ</span>
              </label>
            </div>
            {fileProblem && (
              <p className="agent-warning" role="alert">
                {fileProblem}
              </p>
            )}
          </li>
        </ol>
        {checked && (
          <section className="agent-check" aria-label="読み込む内容の確認">
            <h3>この内容で下書きを置き換えます</h3>
            <dl>
              <dt>タイトル</dt>
              <dd>{checked.title || '（なし）'}</dd>
              <dt>本文</dt>
              <dd>
                {Array.from(checked.body).length.toLocaleString()}文字
                {checked.body && <q>{Array.from(checked.body.trim()).slice(0, 60).join('')}…</q>}
              </dd>
              {hasMetadata(checked.metadata) && (
                <>
                  <dt>概要・タグなど</dt>
                  <dd>
                    概要・タグ・想定読者などは、右上の「公開する」を押すと入れられます（自動では公開しません）。入れる前にこの画面を離れると消えます。
                  </dd>
                </>
              )}
            </dl>
            {checked.warnings.length > 0 && (
              <ul className="agent-warnings">
                {checked.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <p className="agent-note">
              公開前に、自分の経験と違うところ・人の名前や秘密が残っていないかを必ず読んで確かめてください。
            </p>
            <div className="agent-row">
              <Button
                className="agent-button agent-button--primary"
                disabled={disabled || (!checked.title && !checked.body)}
                onClick={() => {
                  onApply(checked);
                  setChecked(null);
                  setSource('');
                }}
              >
                下書きに反映
              </Button>
              <Button className="agent-button" onClick={() => setChecked(null)}>
                やめる
              </Button>
            </div>
          </section>
        )}
        {canUndo && (
          <p className="agent-undo">
            AIの出力を反映しました。
            <Button className="agent-link" disabled={disabled} onClick={onUndo}>
              反映する前の文章に戻す
            </Button>
          </p>
        )}
      </div>
    </details>
  );
}
