import { expect, type Locator } from '@playwright/test';

/**
 * The article body field is CodeMirror 6 (#306), a contenteditable, so `toHaveValue`・
 * `inputValue` no longer apply. These read the editor's own document instead of the DOM text,
 * which only holds the lines in view. `cmTile` is CodeMirror's internal DOM back-reference (the
 * same one `EditorView.findFromDOM` reads); if an upgrade renames it every caller fails loudly here.
 */
type View = {
  state: {
    doc: { toString(): string; length: number };
    selection: { main: { from: number; to: number } };
  };
  dispatch(spec: unknown): void;
  focus(): void;
};
export function bodyValue(body: Locator) {
  return body.evaluate((element) => {
    const view = (element as unknown as { cmTile?: { root?: { view?: View } } }).cmTile?.root?.view;
    if (!view) throw Error('#draft-body is not a CodeMirror content element');
    return view.state.doc.toString();
  });
}
export async function expectBody(body: Locator, expected: string | RegExp, timeout?: number) {
  const poll = expect.poll(() => bodyValue(body), timeout ? { timeout } : undefined);
  if (typeof expected === 'string') await poll.toBe(expected);
  else await poll.toMatch(expected);
}
/** Selects LF offsets [start, end) and focuses the body, like setSelectionRange did. */
export function selectBody(body: Locator, start: number, end: number) {
  return body.evaluate(
    (element, range) => {
      const view = (element as unknown as { cmTile?: { root?: { view?: View } } }).cmTile?.root
        ?.view;
      if (!view) throw Error('#draft-body is not a CodeMirror content element');
      view.focus();
      view.dispatch({ selection: { anchor: range.start, head: range.end } });
    },
    { start, end },
  );
}
export function bodySelection(body: Locator) {
  return body.evaluate((element) => {
    const view = (element as unknown as { cmTile?: { root?: { view?: View } } }).cmTile?.root?.view;
    if (!view) throw Error('#draft-body is not a CodeMirror content element');
    const { from, to } = view.state.selection.main;
    return { text: view.state.doc.toString().slice(from, to), start: from, end: to };
  });
}
