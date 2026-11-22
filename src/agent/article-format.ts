/**
 * The "agent article" file format: one Markdown file with a small front matter block.
 *
 * Students write articles with their own AI agent (Claude Code, Codex, Antigravity, ChatGPT…).
 * The agent produces this file; the student pastes or picks it in the draft editor, checks the
 * preview and keeps it as an ordinary private draft. Nothing here talks to the server: the
 * existing authenticated draft save and publication checks stay the only write path.
 *
 * Why a plain file instead of an API token: any agent can write a file, the student reviews it
 * before anything is saved, and no new credential or write surface is created (R2 stays as is).
 */

export const ARTICLE_LIMITS = {
  title: 200,
  bodyBytes: 262144,
  summary: 300,
  readerNote: 200,
  tags: 5,
  tagChars: 24,
  minutes: 240,
} as const;

export interface AgentArticleMetadata {
  summary: string;
  tags: string[];
  audience: string;
  prerequisite: string;
  outcome: string;
  minutes: number | null;
}

export interface AgentArticle {
  title: string;
  body: string;
  metadata: AgentArticleMetadata;
  /** Human readable notes about what was shortened, dropped or missing. */
  warnings: string[];
}

const FRONT_MATTER_KEYS: Record<string, keyof AgentArticleMetadata | 'title'> = {
  title: 'title',
  タイトル: 'title',
  summary: 'summary',
  概要: 'summary',
  tags: 'tags',
  タグ: 'tags',
  audience: 'audience',
  想定読者: 'audience',
  prerequisite: 'prerequisite',
  prerequisites: 'prerequisite',
  前提知識: 'prerequisite',
  outcome: 'outcome',
  読んだあとに: 'outcome',
  minutes: 'minutes',
  読了時間: 'minutes',
};

const chars = (value: string) => Array.from(value).length;
const clip = (value: string, max: number) => Array.from(value).slice(0, max).join('');
// Control and format characters never belong in a one-line field (the server rejects them in tags).
const oneLine = (value: string) =>
  value
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function unquote(value: string) {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'"))))
    return v.slice(1, -1).replace(/\\"/g, '"');
  return v;
}

function splitTags(value: string): string[] {
  const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  return inner
    .split(/[,、，]/)
    .map((t) => unquote(t))
    .filter(Boolean);
}

function canonicalTagList(raw: string[], warnings: string[]): string[] {
  const result: string[] = [];
  for (const item of raw) {
    const tag = oneLine(item.normalize('NFKC').replace(/^#\s*/, ''));
    if (!tag) continue;
    if (chars(tag) > ARTICLE_LIMITS.tagChars) {
      warnings.push(
        `タグ「${clip(tag, 12)}…」は${ARTICLE_LIMITS.tagChars}文字を超えるため外しました。`,
      );
      continue;
    }
    if (result.includes(tag)) continue;
    if (result.length === ARTICLE_LIMITS.tags) {
      warnings.push(`タグは${ARTICLE_LIMITS.tags}個までのため、「${tag}」以降を外しました。`);
      break;
    }
    result.push(tag);
  }
  return result;
}

/** Splits `---` front matter from the Markdown body. Returns null when there is none. */
function splitFrontMatter(text: string): { head: string; body: string } | null {
  const match = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return match ? { head: match[1], body: text.slice(match[0].length) } : null;
}

function readFrontMatter(head: string) {
  const values = new Map<string, string | string[]>();
  let listKey: string | null = null;
  let blockKey: string | null = null;
  for (const line of head.split(/\r?\n/)) {
    // `summary: |` / `summary: >` continue on indented lines (folded into one line later).
    if (blockKey && /^\s+\S/.test(line)) {
      const current = values.get(blockKey);
      values.set(blockKey, [...(Array.isArray(current) ? current : []), line.trim()]);
      continue;
    }
    blockKey = null;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const current = values.get(listKey);
      values.set(listKey, [...(Array.isArray(current) ? current : []), unquote(item[1])]);
      continue;
    }
    const pair = /^\s*([^:：#\s][^:：]*?)\s*[:：]\s*(.*)$/.exec(line);
    if (!pair) continue;
    const key =
      FRONT_MATTER_KEYS[pair[1].trim().toLowerCase()] ?? FRONT_MATTER_KEYS[pair[1].trim()];
    if (!key) {
      listKey = null;
      continue;
    }
    if (/^[|>][+-]?$/.test(pair[2].trim())) {
      listKey = null;
      blockKey = key;
      values.set(key, []);
    } else if (pair[2].trim() === '') {
      listKey = key;
      values.set(key, []);
    } else {
      listKey = null;
      values.set(key, unquote(pair[2]));
    }
  }
  return values;
}

/**
 * Reads what an agent wrote. Accepts front matter (English or Japanese keys), or a plain Markdown
 * file whose first `# heading` becomes the title. Never throws; impossible values become warnings.
 */
export function parseAgentArticle(input: string): AgentArticle {
  const warnings: string[] = [];
  const text = input.replace(/\r\n/g, '\n').replace(/\0/g, '');
  const split = splitFrontMatter(text);
  const values = split ? readFrontMatter(split.head) : new Map<string, string | string[]>();
  let body = (split ? split.body : text).replace(/^\n+/, '');
  const text1 = (key: string) => {
    const v = values.get(key);
    return Array.isArray(v) ? v.join(' ') : (v ?? '');
  };

  let title = oneLine(text1('title'));
  const heading = /^#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\n|$)/.exec(body);
  if (heading && (!title || oneLine(heading[1]) === title)) {
    // The page already shows the title above the body, so a duplicated `# title` is dropped.
    title = title || oneLine(heading[1]);
    body = body.slice(heading[0].length).replace(/^\n+/, '');
  }
  if (!title) warnings.push('タイトルが見つかりませんでした。タイトル欄に入力してください。');
  if (chars(title) > ARTICLE_LIMITS.title) {
    title = clip(title, ARTICLE_LIMITS.title);
    warnings.push(`タイトルを${ARTICLE_LIMITS.title}文字に切り詰めました。`);
  }
  body = body.replace(/\s+$/, '') + '\n';
  if (!body.trim()) {
    body = '';
    warnings.push('本文が空でした。');
  }
  if (new TextEncoder().encode(body).byteLength > ARTICLE_LIMITS.bodyBytes)
    warnings.push('本文が256KiBを超えています。保存する前に短くしてください。');

  const note = (
    key: 'summary' | 'audience' | 'prerequisite' | 'outcome',
    label: string,
    max: number,
  ) => {
    const value = oneLine(text1(key));
    if (chars(value) <= max) return value;
    warnings.push(`${label}を${max}文字に切り詰めました。`);
    return clip(value, max);
  };
  const rawTags = values.get('tags');
  const tags = canonicalTagList(
    Array.isArray(rawTags) ? rawTags : rawTags ? splitTags(rawTags) : [],
    warnings,
  );
  const minutesText = oneLine(text1('minutes')).replace(/[分min\s]/gi, '');
  const minutesValue = /^\d{1,3}$/.test(minutesText) ? Number(minutesText) : null;
  const minutes =
    minutesValue !== null && minutesValue >= 1 && minutesValue <= ARTICLE_LIMITS.minutes
      ? minutesValue
      : null;
  if (minutesText && minutes === null)
    warnings.push('読了時間は1〜240の数字だけ使えるため外しました。');

  const metadata: AgentArticleMetadata = {
    summary: note('summary', '概要', ARTICLE_LIMITS.summary),
    tags,
    audience: note('audience', '想定読者', ARTICLE_LIMITS.readerNote),
    prerequisite: note('prerequisite', '前提知識', ARTICLE_LIMITS.readerNote),
    outcome: note('outcome', '読んだあとに', ARTICLE_LIMITS.readerNote),
    minutes,
  };
  if (!metadata.summary) warnings.push('概要がありません。公開するときに入力してください。');
  return { title, body, metadata, warnings };
}

export const hasMetadata = (m: AgentArticleMetadata) =>
  Boolean(m.summary || m.tags.length || m.audience || m.prerequisite || m.outcome || m.minutes);

/** The file format, shared by the copyable request, the /agents page and the downloadable kit. */
export const ARTICLE_FORMAT_EXAMPLE = `---
title: 初めてのチーム制作で、GitHub のプルリクを毎日出してわかったこと
summary: 1年生のC言語チーム制作で、毎日プルリクを出してレビューし合った2週間の記録。最初につまずいたことと、続けて変わったことを書きます。
tags: [GitHub, チーム制作, C言語]
audience: チーム制作でGitHubを使い始めた1〜2年生
prerequisite: git add / commit / push を一度やったことがある
outcome: プルリクを小さく出す理由と、レビューで聞くとよいことがわかる
minutes: 6
---

## なぜ書くのか
（ここから本文。見出しは ## から始めます）`;

export const WRITING_RULES = `- 自分（依頼者）が実際にやったこと・確かめたことだけを書く。やっていない経験や数字を作らない。
- 他の人の名前・顔・連絡先、学校のメールアドレス、パスワード・APIキー・トークン、社外秘の情報は書かない（見つけたら伏せる）。
- 課題の解答の丸写しは載せない。考え方や詰まった点は書いてよい。
- 本文は Markdown（GFM）。見出しは ## から。HTML タグは表示されないので使わない。
- 画像は多めに、見出しごとに1枚以上を目安にする。ファイルには埋め込めないので、置きたい場所に「（写真：〇〇）」「（図：〇〇）」と書く（あとで本人がサイトで画像を追加する）。画像は本人が撮った写真か、内容を図にした自作の図版だけ。ネットで見つけた画像・店の公式写真は使わない。AIが作った写真風の画像で実在の店や料理を見せない。
- 読者は神戸電子の学生。専門用語は最初に一言で説明する。
- お店のレビューなら：実際に行った店だけ。行った時期と、値段・メニューは「その時点」と書く。無料提供・割引・依頼があれば書く。店員や他の客を特定しない。`;

/**
 * The text a student copies into their own AI agent. Includes the current draft when there is
 * one, so "続きを書いて" or "読みやすく直して" works without extra explanation.
 */
export function buildWritingRequest(current: { title: string; body: string }, origin: string) {
  const hasDraft = Boolean(current.title.trim() || current.body.trim());
  const task = hasDraft
    ? 'いまの下書き（下に貼ります）を、私の言葉を残したまま記事として仕上げてください。足りない部分は質問してから書いてください。'
    : 'これから私の経験を記事にしたいです。まず、何について書くか・誰に向けて書くかを私に3つまで質問してから書いてください。';
  return [
    `あなたは Kobe Student Hub（${origin}）に載せる記事を一緒に書くアシスタントです。`,
    'Kobe Student Hub は、神戸電子の学生が学習や制作の経験を記事にして共有する場所です（学校公式ではありません）。',
    '',
    `## お願い`,
    task,
    '',
    '## 守ること',
    WRITING_RULES,
    '',
    '## 出力の形',
    '次の形の Markdown ファイル1つだけを、コードブロックで出力してください。私がそのままサイトの下書き画面に貼り付けます。',
    '概要は300文字以内、想定読者・前提知識・読んだあとには各200文字以内、タグは5個まで（1個24文字以内）、minutes は読むのにかかる分数です。',
    '',
    '```markdown',
    ARTICLE_FORMAT_EXAMPLE,
    '```',
    ...(hasDraft
      ? ['', '## いまの下書き', '', `タイトル：${current.title || '（未入力）'}`, '', current.body]
      : []),
  ].join('\n');
}

/** A published article as one Markdown document, for handing it to an AI agent as context. */
export function articleForAgent(article: {
  title: string;
  summary: string;
  tags: string[];
  audience: string;
  prerequisite: string;
  outcome: string;
  body: string;
  authorName: string;
  url: string;
}) {
  const lines = [
    `# ${article.title}`,
    '',
    `- 出典: Kobe Student Hub（学生が書いた記事） ${article.url}`,
    `- 書いた人: ${article.authorName}`,
    `- 概要: ${article.summary}`,
  ];
  if (article.tags.length) lines.push(`- タグ: ${article.tags.join(', ')}`);
  if (article.audience) lines.push(`- 想定読者: ${article.audience}`);
  if (article.prerequisite) lines.push(`- 前提知識: ${article.prerequisite}`);
  if (article.outcome) lines.push(`- 読んだあとに: ${article.outcome}`);
  lines.push('', '---', '', article.body.trim(), '');
  return lines.join('\n');
}
