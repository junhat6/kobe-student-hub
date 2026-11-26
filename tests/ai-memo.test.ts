import { describe, it, expect } from 'vitest';
import { findAiMemos, removeAiMemos } from '../src/editor/ai-memo';

describe('AIメモ (#302)', () => {
  it('removes the leading memo line and the blank line after it', () => {
    const body = '（AIメモ：材料のうち、授業の話を選んだ）\n\n## はじめに\n本文です。\n';
    expect(findAiMemos(body)).toHaveLength(1);
    expect(removeAiMemos(body)).toBe('## はじめに\n本文です。\n');
  });

  it('keeps nested parentheses inside the memo and handles half-width ones', () => {
    const body = '(AIメモ: 候補（3つ）から選んだ (理由あり))\n\n本文\n';
    expect(removeAiMemos(body)).toBe('本文\n');
    const full = '（AIメモ：候補（A）とB）\r\n\r\n本文';
    expect(removeAiMemos(full)).toBe('本文');
  });

  it('removes a memo inside a sentence without touching the rest', () => {
    expect(removeAiMemos('今日は晴れ（AIメモ：天気は推測）。\n')).toBe('今日は晴れ。\n');
    expect(removeAiMemos('（AIメモ：x） 始まり\n')).toBe('始まり\n');
  });

  it('removes every memo, including one in the middle', () => {
    const body = '（AIメモ：1）\n\n前\n\n（AIメモ：2）\n\n後\n';
    expect(findAiMemos(body)).toHaveLength(2);
    expect(removeAiMemos(body)).toBe('前\n\n後\n');
  });

  it('ignores memos in fenced code, unclosed memos and memos broken by a blank line', () => {
    const code = '```md\n（AIメモ：例）\n```\n';
    expect(findAiMemos(code)).toEqual([]);
    expect(removeAiMemos(code)).toBe(code);
    const tilde = '~~~\n（AIメモ：例）\n~~~\n（AIメモ：本物）\n本文';
    expect(removeAiMemos(tilde)).toBe('~~~\n（AIメモ：例）\n~~~\n本文');
    for (const body of ['（AIメモ：閉じない\n本文', '（AIメモ：段落\n\nまたぐ）', '本文だけ']) {
      expect(findAiMemos(body)).toEqual([]);
      expect(removeAiMemos(body)).toBe(body);
    }
  });

  it('spans soft line breaks within one paragraph', () => {
    expect(removeAiMemos('（AIメモ：一行目\n二行目）\n\n本文')).toBe('本文');
  });

  it('does not treat 「AIメモ」 without an opening parenthesis as a memo', () => {
    const body = 'AIメモという機能について書きます。\n';
    expect(removeAiMemos(body)).toBe(body);
  });
});
