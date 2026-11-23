import AxeBuilder from '@axe-core/playwright';
import { actor } from './helpers/fictional-actor';
import { TASTE_SHARING_RELEASE_ENABLED } from '../src/shared/agent-release';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

// #243 (C23 condition 4): the student's own ledger on the account page. Lines are deleted one at
// a time, and 「運営に見せる」 is the student's own toggle (off by default). Only shown lines reach
// the operator's 好み, with nothing about who wrote them. The screens exist only in a build with
// the release flag open, so this spec runs exactly when the flag is flipped; closed, the gate is
// covered by tests/taste-sharing.test.ts.
test.skip(!TASTE_SHARING_RELEASE_ENABLED, 'TASTE_SHARING_RELEASE_ENABLED is closed');

async function seriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(' ')) }));
}
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('a student shows one ledger line to operators, deletes another, and the operator sees only the shown line', async ({
  browser,
  page,
}, info) => {
  const contexts: BrowserContext[] = [];
  const key = info.project.name + '-' + Date.now().toString(36);
  const region = (p: Page) => p.getByRole('region', { name: 'あなたの好み', exact: true });
  try {
    const student = await actor(browser, contexts, '架空の台帳の持ち主-' + key);
    const mine = await student.context.newPage();
    await mine.setViewportSize(page.viewportSize()!);
    // No ledger yet: the section is not there at all.
    await mine.goto('/account');
    await expect(mine.getByRole('heading', { name: 'マイページ' })).toBeVisible();
    await expect(region(mine)).toHaveCount(0);
    expect(
      (
        await student.context.request.get('/__control/taste-ledger?actor=' + student.subject)
      ).status(),
    ).toBe(200);

    await mine.reload();
    const ledger = region(mine);
    await expect(ledger).toBeVisible();
    await expect(ledger.getByRole('listitem')).toHaveCount(3);
    const show = (text: string) =>
      ledger.getByRole('button', { name: '運営に見せる：' + text, exact: true });
    for (const text of [
      '結論を見出しの直後に書く',
      '手順は番号つきの箇条書きにする',
      '設定はアイコンで足りる',
    ])
      await expect(show(text)).toHaveAttribute('aria-pressed', 'false');
    expect.soft(await seriousViolations(mine)).toEqual([]);
    expect(await noHorizontalScroll(mine)).toBe(true);

    await show('結論を見出しの直後に書く').click();
    await expect(show('結論を見出しの直後に書く')).toHaveAttribute('aria-pressed', 'true');
    await ledger.getByRole('button', { name: '削除：手順は番号つきの箇条書きにする' }).click();
    await expect(ledger.getByRole('listitem')).toHaveCount(2);
    await expect(ledger).not.toContainText('手順は番号つきの箇条書きにする');
    await mine.reload();
    await expect(region(mine).getByRole('listitem')).toHaveCount(2);
    await expect(show('結論を見出しの直後に書く')).toHaveAttribute('aria-pressed', 'true');
    await expect(show('設定はアイコンで足りる')).toHaveAttribute('aria-pressed', 'false');
    expect.soft(await seriousViolations(mine)).toEqual([]);
    expect(await noHorizontalScroll(mine)).toBe(true);
    await region(mine).scrollIntoViewIfNeeded();
    await mine.screenshot({ path: info.outputPath('own-taste.png'), scale: 'css' });

    // The student is not an operator: the shared list is 404 for them and for signed-out readers.
    expect(
      (await student.context.request.get('/api/private/editorial-taste/shared')).status(),
    ).toBe(404);
    expect((await page.request.get('/api/private/editorial-taste/shared')).status()).toBe(404);

    // A server-listed operator. The header is a fixture-only stand-in for the allowlist.
    const operator = await actor(browser, contexts, '架空の運営者-' + key);
    await operator.context.setExtraHTTPHeaders({ 'X-Test-Operator-Subject': operator.subject });
    const ops = await operator.context.newPage();
    await ops.setViewportSize(page.viewportSize()!);
    await ops.goto('/account');
    const taste = ops.getByRole('region', { name: '好み', exact: true });
    await expect(taste).toBeVisible();
    const shown = taste.getByRole('list', { name: '学生が見せた好みの行' });
    await expect(shown).toContainText('結論を見出しの直後に書く');
    await expect(shown).not.toContainText('設定はアイコンで足りる');
    await expect(shown).not.toContainText('手順は番号つきの箇条書きにする');
    const text = await ops.locator('body').innerText();
    for (const value of ['架空の台帳の持ち主-' + key, student.subject, student.profileId])
      expect(text).not.toContain(value);
    const raw = await (
      await operator.context.request.get('/api/private/editorial-taste/shared')
    ).text();
    for (const value of [student.subject, student.profileId, '架空の台帳の持ち主'])
      expect(raw).not.toContain(value);
    expect.soft(await seriousViolations(ops)).toEqual([]);
    expect(await noHorizontalScroll(ops)).toBe(true);
    await shown.scrollIntoViewIfNeeded();
    await ops.screenshot({ path: info.outputPath('operator-shared-taste.png'), scale: 'css' });

    // Turning it off removes it from the operator's list.
    await show('結論を見出しの直後に書く').click();
    await expect(show('結論を見出しの直後に書く')).toHaveAttribute('aria-pressed', 'false');
    await ops.reload();
    await expect(ops.getByRole('region', { name: '好み', exact: true })).toBeVisible();
    await expect(ops.getByRole('list', { name: '学生が見せた好みの行' })).toHaveCount(0);
    await expect(ops.getByRole('region', { name: '好み', exact: true })).toContainText(
      '学生が見せた行',
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
