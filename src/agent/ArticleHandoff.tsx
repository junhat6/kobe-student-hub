import { useState } from 'react';
import { Button } from '@base-ui/react/button';
import { articleForAgent } from './article-format';
import { copyText } from './clipboard';
import Icon from '../shared/Icon';
import './agent.css';

/**
 * Copies a published article as Markdown (with source URL and reader notes) so a reader can ask
 * their own AI agent about it: "この記事の前提を説明して", "自分のプロジェクトで試す手順にして".
 * Only the public DTO already shown on the page is copied.
 */
export default function ArticleHandoff(props: {
  title: string;
  summary: string;
  tags: string[];
  audience: string;
  prerequisite: string;
  outcome: string;
  body: string;
  authorName: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy() {
    const url = window.location.origin + window.location.pathname;
    setState((await copyText(articleForAgent({ ...props, url }))) ? 'copied' : 'failed');
  }
  return (
    <div className="agent-handoff">
      <Button className="agent-button" onClick={() => void copy()}>
        <Icon name={state === 'copied' ? 'check' : 'copy'} size={18} />
        AIに渡す（Markdownでコピー）
      </Button>
      <span className="sr-only" role="status">
        {state === 'copied' ? 'コピーしました' : ''}
      </span>
      {state === 'failed' ? (
        <span role="alert">コピーできませんでした。ブラウザの設定を確認してください。</span>
      ) : (
        <span>記事を自分のAIに読ませて、わからないところを聞けます。</span>
      )}
    </div>
  );
}
