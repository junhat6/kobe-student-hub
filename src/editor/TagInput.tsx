import { useRef, useState } from 'react';
import Icon from '../shared/Icon';

/** Same limits the server enforces (canonicalTags / publication API); the server stays the authority. */
export const TAG_LIMIT = 5;
const TAG_LENGTH = 24;
const separators = /[,、，]/;

export function splitTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

interface Props {
  id: string;
  /** Comma-joined tags; the composer's saved state and checks keep this one string form. */
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  /** Tags already used in public articles, offered while typing. */
  candidates?: string[];
}

/**
 * Qiita/Zenn style tag entry (#231): Enter or a comma turns the text into a chip, × removes it,
 * and the field closes at five tags. Rules are shown only when a tag breaks one.
 */
export default function TagInput({ id, value, onChange, readOnly, candidates = [] }: Props) {
  const [pending, setPending] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState('');
  const tags = splitTags(value);
  const normalized = tags.map((tag) => tag.normalize('NFKC'));
  const full = tags.length >= TAG_LIMIT;

  function commit(text: string) {
    const next = [...tags];
    const seen = new Set(normalized);
    let issue = '';
    for (const raw of text.split(separators)) {
      const tag = raw.normalize('NFKC').trim();
      if (!tag) continue;
      if (next.length >= TAG_LIMIT) issue = `タグは${TAG_LIMIT}件までです。`;
      else if (Array.from(tag).length > TAG_LENGTH)
        issue = `「${tag}」は${TAG_LENGTH}文字を超えています。`;
      else if (/[\p{Cc}\p{Cf}]/u.test(tag)) issue = '使えない文字が入っています。';
      else if (seen.has(tag)) issue = `「${tag}」はもう入っています。`;
      else {
        next.push(tag);
        seen.add(tag);
        continue;
      }
      // Keep the rejected text in the field so the author can fix it.
      setPending(raw.trim());
      setProblem(issue);
      if (next.length !== tags.length) onChange(next.join(', '));
      return;
    }
    setPending('');
    setProblem('');
    if (next.length !== tags.length) onChange(next.join(', '));
  }

  function remove(index: number) {
    setProblem('');
    onChange(tags.filter((_, i) => i !== index).join(', '));
  }

  const offered = candidates.filter((tag) => !normalized.includes(tag.normalize('NFKC')));
  return (
    <div className="tag-input">
      {/* Chips and the text field share one row, so committing a tag on blur never moves the
          controls below it (a moved target swallows the click that caused the blur). */}
      <div
        className={readOnly ? 'tag-field tag-field-readonly' : 'tag-field'}
        onClick={(event) => {
          if (event.target === event.currentTarget) field.current?.focus();
        }}
      >
        <ul className="publication-tags" aria-label="公開されるタグ">
          {tags.map((tag, index) => (
            <li key={tag + index}>
              <span>{tag.normalize('NFKC')}</span>
              {!readOnly && (
                <button type="button" aria-label={`${tag}を外す`} onClick={() => remove(index)}>
                  <Icon name="close" size={14} />
                </button>
              )}
            </li>
          ))}
          {readOnly && tags.length === 0 && (
            <li>
              <span>タグなし</span>
            </li>
          )}
        </ul>
        {!readOnly && !full && (
          <input
            ref={field}
            id={id}
            value={pending}
            maxLength={160}
            enterKeyHint="enter"
            autoComplete="off"
            placeholder={tags.length ? 'タグを足す' : '例：TypeScript'}
            list={offered.length ? id + '-candidates' : undefined}
            aria-describedby={problem ? id + '-problem' : undefined}
            aria-invalid={problem ? true : undefined}
            onChange={(event) => {
              const text = event.target.value;
              setProblem('');
              if (separators.test(text)) commit(text);
              else setPending(text);
            }}
            onKeyDown={(event) => {
              // Enter while the Japanese IME is converting only confirms the conversion.
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                commit(pending);
              } else if (event.key === 'Backspace' && !pending && tags.length) {
                remove(tags.length - 1);
              }
            }}
            onBlur={() => {
              if (pending.trim()) commit(pending);
            }}
          />
        )}
      </div>
      {!readOnly && offered.length > 0 && (
        <datalist id={id + '-candidates'}>
          {offered.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
      )}
      {problem && (
        <p id={id + '-problem'} className="publication-warning" role="alert">
          {problem}
        </p>
      )}
      {!readOnly && full && <small>タグは{TAG_LIMIT}件までです。外すと足せます。</small>}
    </div>
  );
}
