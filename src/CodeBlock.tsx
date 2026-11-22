import { useRef } from 'react';
import type { ReactNode } from 'react';
import CopyButton from './shared/CopyButton';
export default function CodeBlock({ children }: { children?: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  // When the clipboard refuses, select the code so the device's own copy works at once.
  const select = () => {
    const selection = window.getSelection();
    if (!pre.current || !selection) return;
    pre.current.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(pre.current);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  return (
    <div className="code-block">
      <div className="code-tools">
        <CopyButton
          label="コードをコピー"
          text={() => pre.current?.textContent ?? ''}
          onFailed={select}
        />
      </div>
      {/* Focusable so keyboard users can scroll long lines on narrow screens. */}
      <pre ref={pre} tabIndex={0} aria-label="コード">
        {children}
      </pre>
    </div>
  );
}
