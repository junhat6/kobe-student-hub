import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { Annotation, Compartment, EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderText } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { textareaText } from './markdown-format';

/**
 * The Markdown body field (#306, C25). CodeMirror 6 edits the Markdown string itself, so opening a
 * draft never rewrites `（写真：…）`・`（AIメモ：…）`・embed lines the way a document-model editor
 * (Milkdown・Tiptap) would when it serializes back. The parent keeps the string as the source of
 * truth; this field only reports edits and mirrors replacements made by the parent.
 */
export interface BodyEditorHandle {
  /** Selection as LF offsets, the same offsets formatMarkdown takes. */
  selection(): { start: number; end: number } | null;
  /** Current editor text (line breaks are LF). */
  text(): string | null;
  select(start: number, end: number): void;
}

/** Parent-driven replacements: mirrored into the editor but never reported back as user input. */
const external = Annotation.define<boolean>();
/** Matches the old textarea's maxLength; the 256 KiB byte limit still shows its own alert. */
const MAX_LENGTH = 262144;

/** The smallest replacement that turns `from` into `to`, so the cursor and undo stay local. */
function diff(from: string, to: string) {
  let start = 0;
  const limit = Math.min(from.length, to.length);
  while (start < limit && from.charCodeAt(start) === to.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < limit - start &&
    from.charCodeAt(from.length - 1 - end) === to.charCodeAt(to.length - 1 - end)
  )
    end++;
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) };
}

/** Like the old textarea's `disabled`: not editable, and announced as unavailable. */
const lockExtensions = (disabled: boolean) => [
  EditorView.editable.of(!disabled),
  EditorState.readOnly.of(disabled),
  EditorView.contentAttributes.of(disabled ? { 'aria-disabled': 'true' } : {}),
];

const BodyEditor = forwardRef<
  BodyEditorHandle,
  {
    id: string;
    labelledBy: string;
    value: string;
    disabled: boolean;
    placeholder: string;
    onChange(value: string): void;
    onCompositionStart(): void;
    onCompositionEnd(): void;
    /** Returns true when the paste was handled (an embed line was inserted). */
    onPaste(text: string): boolean;
    /** Ctrl/Cmd+B. */
    onBold(): void;
  }
>(function BodyEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const editable = useRef(new Compartment());

  useLayoutEffect(() => {
    const state = EditorState.create({
      doc: textareaText(props.value),
      extensions: [
        history(),
        // markdown() brings markdownKeymap: Enter continues a list/quote item and clears an empty
        // one, Backspace removes the markup (C25 acceptance 2).
        markdown(),
        keymap.of([
          {
            key: 'Mod-b',
            run: (v) => {
              if (!v.composing) callbacks.current.onBold();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        EditorView.lineWrapping,
        placeholderText(props.placeholder),
        editable.current.of(lockExtensions(props.disabled)),
        EditorView.contentAttributes.of({
          id: props.id,
          'aria-labelledby': props.labelledBy,
          spellcheck: 'false',
          autocapitalize: 'off',
        }),
        EditorState.changeFilter.of(
          (tr) => Boolean(tr.annotation(external)) || tr.newDoc.length <= MAX_LENGTH,
        ),
        EditorView.domEventHandlers({
          compositionstart: () => {
            callbacks.current.onCompositionStart();
            return false;
          },
          compositionend: () => {
            callbacks.current.onCompositionEnd();
            return false;
          },
          paste: (event, v) => {
            if (v.composing) return false;
            const handled = callbacks.current.onPaste(
              event.clipboardData?.getData('text/plain') ?? '',
            );
            if (handled) event.preventDefault();
            return handled;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          if (update.transactions.every((tr) => tr.annotation(external))) return;
          callbacks.current.onChange(update.state.doc.toString());
        }),
      ],
    });
    const created = new EditorView({ state, parent: host.current! });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
    // The view is created once per mount; later props are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Parent replacements (format buttons, AI memo removal, photo placement, another draft) are
  // applied before the parent's own layout effect restores the selection.
  useLayoutEffect(() => {
    const current = view.current;
    if (!current) return;
    const doc = current.state.doc.toString();
    const next = textareaText(props.value);
    if (doc === next) return;
    current.dispatch({ changes: diff(doc, next), annotations: external.of(true) });
  }, [props.value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure(lockExtensions(props.disabled)),
    });
  }, [props.disabled]);

  useImperativeHandle(
    ref,
    () => ({
      selection() {
        const current = view.current;
        if (!current) return null;
        const main = current.state.selection.main;
        return { start: main.from, end: main.to };
      },
      text() {
        return view.current ? view.current.state.doc.toString() : null;
      },
      select(start, end) {
        const current = view.current;
        if (!current) return;
        const length = current.state.doc.length;
        if (start < 0 || end < start || end > length) return;
        current.focus();
        current.dispatch({
          selection: EditorSelection.single(start, end),
          scrollIntoView: true,
        });
      },
    }),
    [],
  );

  return <div className="editor-body" ref={host} />;
});

export default BodyEditor;
