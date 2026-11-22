import { useEffect, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import Icon from './Icon';
import './copy-button.css';

/**
 * Copy shown as an icon that turns into a check, instead of "コピー" / "コピーしました" text.
 * The accessible name says what is copied; the result is announced, not printed.
 * Only a failure is written out, because then the student has to act.
 */
export default function CopyButton({
  text,
  label,
  className,
  onFailed,
}: {
  /** Text to copy, read at click time. */
  text: () => string;
  /** Accessible name, e.g. "コードをコピー". */
  label: string;
  className?: string;
  /** Called when the clipboard refused, e.g. to select the text for a manual copy. */
  onFailed?: () => void;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    clearTimeout(timer.current);
    try {
      if (!navigator.clipboard?.writeText) throw Error();
      await navigator.clipboard.writeText(text());
      setState('copied');
      timer.current = setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('failed');
      onFailed?.();
    }
  }
  return (
    <span className={'copy-button' + (className ? ' ' + className : '')}>
      <Button
        type="button"
        className="icon-button"
        aria-label={label}
        title={label}
        data-state={state}
        onClick={() => void copy()}
      >
        <Icon name={state === 'copied' ? 'check' : 'copy'} size={18} />
      </Button>
      <span className="sr-only" role="status">
        {state === 'copied' ? 'コピーしました' : ''}
      </span>
      {state === 'failed' && (
        <span className="copy-button-failed" role="alert">
          コピーできませんでした。選んでコピーしてください。
        </span>
      )}
    </span>
  );
}
