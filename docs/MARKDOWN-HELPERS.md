# Existing Markdown helpers

Cycle24/#49 corrects existing heading/bold/code buttons in the isolated editor. Independent baseline browsing on main cc5177 reproduced a mid-paragraph heading that remained plain text, and selected triple-backtick code that escaped into a normal paragraph. This establishes existing behavior, not student usefulness. Source PRD is unchanged.

## Editing contract

Heading and code target the complete logical lines touched by a selection; a collapsed caret targets its line. A selection ending at the start of the next line excludes that next line. Unaffected lines remain byte-for-byte unchanged. This is a line-based aid, not a parser of enclosing Markdown lists/quotes/fences.

Heading makes targeted nonblank lines level2. The marker rule follows [CommonMark ATX headings](https://spec.commonmark.org/0.31.2/#atx-headings), including empty headings whose marker ends the line. Existing valid ATX markers are normalized instead of duplicated; a sole empty current line gets an editable placeholder. Blank lines within a selection remain blank. Code uses a fence longer than the longest backtick run in the targeted text, with opening/closing fences on their own lines. The original selected text/caret is mapped into the payload (excluding the block-delimiter newline when a selection ends at the next line); inserted placeholders are selected. Bold keeps its existing inline wrapping contract. No additional format buttons, image/embed support or Markdown renderer changes are introduced.

After the action, focus/selection return to the current textarea without silently saving. Existing byte/title validation and explicit save/preview/navigation protection still apply. While composition is in progress, helper buttons and edit/preview switching wait; synchronous guards also reject an event delivered before the disabled state renders. This avoids unmounting the composing textarea without forcing commit/cancel. Synthetic composition tests cannot establish physical Japanese IME behavior. Pending save permits continued edits, which remain a later unsaved version rather than being replaced by an older acknowledgement.

## Release and evidence limits

Only local fictional author journeys are connected. Actual school Google/admission/platform privacy,operator notifications/decisions/contact and media/retention remain separate release gates in #38. PC/mobile Chromium emulation is distinct from real devices/Safari/IME/accessibility testing and student value trials. No new schema,remote data,credentials/grants,contracts,R2,mail,deployment or screenshot publication is needed for this correction. Existing held originals remain held.
