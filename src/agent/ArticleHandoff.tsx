import { useState } from 'react';
import { Button } from '@base-ui/react/button';
import { articleForAgent } from './article-format';
import { copyText } from './clipboard';
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
        <span aria-hidden="true">✦ </span>AIに渡す（Markdownでコピー）
      </Button>
      <span role="status">
        {state === 'copied'
          ? 'コピーしました。自分のAIに貼って、質問や「自分の場合」を聞いてみてください。'
          : state === 'failed'
            ? 'コピーできませんでした。ブラウザの設定を確認してください。'
            : '記事を自分のAIに読ませて、わからないところを聞けます。'}
      </span>
    </div>
  );
}
