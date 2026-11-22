import AxeBuilder from '@axe-core/playwright';
import { encode as pngEncode } from 'fast-png';
import { actor, write } from './helpers/fictional-actor';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

// #198: a student sets and deletes their own profile icon from the account page, anonymous
// readers see it on the author page, and an operator removes a reported icon with a reason
// that reaches the owner's notices. Every actor is fictional; no Google photo is involved.
async function seriousViolations(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => !(a instanceof CSSTransition) || a.playState !== 'running'),
  );
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(' ')) }));
}
// A wide camera-like photo: the browser crops it to the centre square before upload.
const photo = Buffer.from(
  pngEncode({
    width: 640,
    height: 480,
    data: Uint8Array.from({ length: 640 * 480 * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : i % 4 === 0 ? 40 : i % 4 === 1 ? 140 : 220,
    ),
    channels: 4,
  }),
);
const loaded = (page: Page, selector: string) =>
  page.waitForFunction((s) => {
    const img = document.querySelector<HTMLImageElement>(s);
    return !!img && img.complete && img.naturalWidth > 0;
  }, selector);

test('a student sets an icon, readers see it, and an operator removes a reported one', async ({
  browser,
  page,
}, info) => {
  const contexts: BrowserContext[] = [];
  const key = info.project.name + '-' + Date.now().toString(36);
  try {
    const author = await actor(browser, contexts, '架空のアイコン投稿者-' + key);
    const draft = await write(author, '/api/private/project-drafts', {
      title: 'アイコン確認の作品-' + key,
      description: '架空の作品',
      githubUrl: '',
      demoUrl: '',
    });
    await write(author, '/api/private/project-publications/' + draft.id, {
      expectedVersion: draft.version,
      confirmPublic: true,
    });
    const mine = await author.context.newPage();
    await mine.setViewportSize(page.viewportSize()!);
    await mine.goto('/account');
    const region = mine.getByRole('region', { name: 'プロフィール', exact: true });
    const change = region.getByRole('button', { name: 'アイコン画像を変える', exact: true });
    await expect(change).toBeVisible();
    // No icon yet: no trash button, the initial is shown.
    await expect(region.getByRole('button', { name: 'アイコン画像を消す' })).toHaveCount(0);
    const chooser = mine.waitForEvent('filechooser');
    await change.click();
    await (await chooser).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: photo });
    await expect(region.getByRole('status')).toHaveText('アイコン画像を変えました。');
    await loaded(mine, '.profile-editor-avatar img');
    expect(
      await mine
        .locator('.profile-editor-avatar img')
        .evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight]),
    ).toEqual([256, 256]);
    expect.soft(await seriousViolations(mine)).toEqual([]);
    expect(await mine.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await region.screenshot({ path: info.outputPath('avatar-own.png') });

    // An anonymous reader sees it on the author page.
    const profilePath = '/students/' + author.profileId;
    await page.goto(profilePath);
    await expect(page.getByRole('heading', { name: '架空のアイコン投稿者-' + key })).toBeVisible();
    await loaded(page, '.profile-side .avatar img');
    expect(await page.locator('.profile-side .avatar img').getAttribute('src')).toMatch(
      new RegExp(`^/api/profile-avatars/${author.profileId}/[0-9a-f]{16}$`),
    );
    expect.soft(await seriousViolations(page)).toEqual([]);
    await page.screenshot({ path: info.outputPath('avatar-public.png'), scale: 'css' });

    // Another student reports the profile; a server-listed operator removes the icon.
    const reader = await actor(browser, contexts, '架空のアイコン通報者-' + key);
    await write(reader, '/api/private/profile-reports/' + author.profileId, {
      reason: '架空の通報理由-' + key,
    });
    const operator = await actor(browser, contexts, '架空のアイコン運営者-' + key);
    await operator.context.setExtraHTTPHeaders({ 'X-Test-Operator-Subject': operator.subject });
    const ops = await operator.context.newPage();
    await ops.setViewportSize(page.viewportSize()!);
    // #208: hold the first case read so the explicit session re-check aborts it mid-flight, as a
    // slow CI runner did. The view must re-read after resuming instead of staying failed.
    let held = false;
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    const reached = new Promise<void>((resolve) =>
      ops.route('**/api/private/profile-moderation/cases/*', async (route) => {
        if (held) return route.continue();
        held = true;
        resolve();
        await released;
        await route.continue().catch(() => {});
      }),
    );
    await ops.goto('/moderation?type=profile&case=' + author.profileId);
    await reached;
    await ops.getByRole('button', { name: '運営セッションを確認', exact: true }).click();
    release();
    const detail = ops.getByRole('region', { name: '選択した通報内容' });
    await expect(detail.getByRole('img', { name: 'いまのアイコン画像' })).toBeVisible();
    await detail.getByLabel('外す理由（本人に届きます）').fill('架空の取り外し理由-' + key);
    expect.soft(await seriousViolations(ops)).toEqual([]);
    await detail.getByRole('button', { name: 'アイコン画像を外す', exact: true }).click();
    await expect(ops.locator('.moderation-message')).toHaveText(
      'アイコン画像を外しました。本人のお知らせに理由が届きます。',
    );
    await expect(detail).toContainText('アイコン画像は設定されていません。');
    await ops.screenshot({ path: info.outputPath('avatar-operator.png'), fullPage: true });

    // Readers get the initial again, and the owner reads the reason.
    await page.reload();
    await expect(page.locator('.profile-side .avatar')).toHaveText('架');
    await expect(page.locator('.profile-side .avatar img')).toHaveCount(0);
    await mine.reload();
    const notices = mine.getByRole('region', { name: '運営からのお知らせ' });
    await expect(notices).toContainText('プロフィールのアイコン画像が外されました');
    await expect(notices).toContainText('架空の取り外し理由-' + key);
    await expect(mine.locator('.profile-editor-avatar img')).toHaveCount(0);

    // The owner sets a new one and deletes it with the trash button.
    const again = mine.waitForEvent('filechooser');
    await change.click();
    await (await again).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: photo });
    await expect(region.getByRole('status')).toHaveText('アイコン画像を変えました。');
    await region.getByRole('button', { name: 'アイコン画像を消す', exact: true }).click();
    await expect(region.getByRole('status')).toHaveText('アイコン画像を消しました。');
    await expect(mine.locator('.profile-editor-avatar img')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.profile-side .avatar')).toHaveText('架');
    const text = await page.locator('body').innerText();
    for (const value of [author.subject, 'st.kobedenshi.ac.jp']) expect(text).not.toContain(value);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
