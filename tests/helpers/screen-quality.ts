import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// C19 screen checks shared by the HTTPS release fixture and the editor (operator) fixture.
const MIN = 44;

// Controls smaller than MIN in either direction. Links inside running text are exempt, as in
// WCAG 2.5.8: enlarging them would break the sentence they belong to.
export function smallTargets(page: Page) {
  return page.evaluate((min) => {
    const selector =
      'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [tabindex]:not([tabindex="-1"])';
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (!r.width || !r.height || style.visibility === 'hidden') continue;
      if (el.closest('.sr-only, .skip, .editor-skip')) continue;
      // A checkbox or radio is pressed through its label, so the label is the target.
      const label =
        el instanceof HTMLInputElement && /^(checkbox|radio)$/.test(el.type)
          ? el.closest('label') || el.labels?.[0]
          : null;
      const box = label ? label.getBoundingClientRect() : r;
      if (style.display === 'inline' && el.parentElement) {
        const text = [...el.parentElement.childNodes].some(
          (n) => n !== el && n.nodeType === Node.TEXT_NODE && n.textContent!.trim(),
        );
        if (text) continue;
      }
      if (box.width < min || box.height < min) {
        const name = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim();
        out.push(
          `${el.tagName.toLowerCase()}.${el.className} "${name.slice(0, 30)}" ${Math.round(box.width)}x${Math.round(box.height)}`,
        );
      }
    }
    return out;
  }, MIN);
}

export const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// Tab through the page and record every stop that is invisible or shows no change when focused.
// The indicator may sit on the control itself or on a wrapper (:focus-within / :has rings on the
// search box and cards), so compare the focused and blurred styles of the control and 3 parents.
export async function keyboardGaps(page: Page, limit = 120) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.locator('body').focus();
  const gaps: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const chain = [el];
      while (chain.length < 4 && chain[chain.length - 1].parentElement)
        chain.push(chain[chain.length - 1].parentElement!);
      const look = () =>
        chain
          .map((node) => {
            const s = getComputedStyle(node);
            return [
              s.outlineStyle,
              s.outlineWidth,
              s.outlineColor,
              s.boxShadow,
              s.borderColor,
              s.backgroundColor,
            ].join(' ');
          })
          .join('|');
      const focused = look();
      el.blur();
      const blurred = look();
      el.focus({ preventScroll: true });
      const r = el.getBoundingClientRect();
      return {
        key:
          el.tagName +
          '|' +
          (el.textContent || '').slice(0, 40) +
          '|' +
          Math.round(r.top + scrollY) +
          '|' +
          Math.round(r.left),
        label: `${el.tagName.toLowerCase()}.${el.className} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}"`,
        visible: r.width > 0 && r.height > 0,
        indicator: focused !== blurred,
      };
    });
    if (!stop || seen.has(stop.key)) break;
    seen.add(stop.key);
    if (!stop.visible || !stop.indicator)
      gaps.push(`${stop.label} visible=${stop.visible} indicator=${stop.indicator}`);
  }
  return { gaps, stops: seen.size };
}

export async function seriousAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(' ')) }));
}

// Width, 44px targets (phones only), Tab stops with a visible indicator; optionally axe.
export async function checkScreen(page: Page, where: string, { axe = false } = {}) {
  expect.soft({ where, overflow: !(await noOverflow(page)) }).toEqual({ where, overflow: false });
  // 44px is a touch guideline; PC(1280) is checked for width and keyboard only.
  if (page.viewportSize()!.width <= 720)
    expect.soft({ where, small: await smallTargets(page) }).toEqual({ where, small: [] });
  const { gaps, stops } = await keyboardGaps(page);
  expect.soft(stops, where + ' has Tab stops').toBeGreaterThanOrEqual(3);
  expect.soft({ where, gaps }).toEqual({ where, gaps: [] });
  if (axe)
    expect.soft({ where, axe: await seriousAxeViolations(page) }).toEqual({ where, axe: [] });
}
