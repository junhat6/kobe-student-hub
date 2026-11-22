import AxeBuilder from '@axe-core/playwright';
import { actor, write } from './helpers/fictional-actor';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

// #198 (first stage): a signed-in student reports another author's public profile from the
// author page, the author never sees a report form on their own page, and a server-listed
// operator reads the report with the profile text the reporter saw. No identity is shown.
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

test('a student reports a public profile and an operator reads it with the reported text', async ({
  browser,
  page,
}, info) => {
  const contexts: BrowserContext[] = [];
  const key = info.project.name + '-' + Date.now().toString(36);
  try {
    const author = await actor(browser, contexts, '架空の通報される投稿者-' + key);
    const draft = await write(author, '/api/private/project-drafts', {
      title: '通報確認の作品-' + key,
      description: '架空の作品',
      githubUrl: '',
      demoUrl: '',
    });
    await write(author, '/api/private/project-publications/' + draft.id, {
      expectedVersion: draft.version,
      confirmPublic: true,
    });
    const profilePath = '/students/' + author.profileId;
    const reportButton = (p: Page) =>
      p.getByRole('button', { name: 'このプロフィールを通報する', exact: true });

    // Anonymous readers see the entry; opening it asks them to sign in instead of a form.
    await page.goto(profilePath);
    await expect(
      page.getByRole('heading', { name: '架空の通報される投稿者-' + key }),
    ).toBeVisible();
    await reportButton(page).click();
    // Scoped: the mobile header can also carry its own ログイン link.
    await expect(
      page
        .getByRole('region', { name: 'プロフィールの通報' })
        .getByRole('link', { name: 'ログイン', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('プロフィールの通報理由（必須）')).toHaveCount(0);

    // The author's own page has no report form.
    const own = await author.context.newPage();
    await own.setViewportSize(page.viewportSize()!);
    await own.goto(profilePath);
    await expect(own.getByRole('button', { name: 'アカウントメニュー' })).toBeVisible();
    await expect(own.getByRole('region', { name: 'プロフィールの通報' })).toHaveCount(0);

    // Another signed-in student reports it.
    const reader = await actor(browser, contexts, '架空の通報する読者-' + key);
    const readerPage = await reader.context.newPage();
    await readerPage.setViewportSize(page.viewportSize()!);
    await readerPage.goto(profilePath);
    await reportButton(readerPage).click();
    const reason = readerPage.getByLabel('プロフィールの通報理由（必須）', { exact: true });
    await expect(reason).toBeEditable();
    expect.soft(await seriousViolations(readerPage)).toEqual([]);
    await reason.fill('架空の通報理由-' + key);
    await readerPage.locator('.project-report-form').getByRole('checkbox').check();
    await readerPage
      .getByRole('button', { name: '確認したプロフィール通報を送信', exact: true })
      .click();
    const status = readerPage.locator('.project-report-form [role="status"]');
    await expect(status).toContainText('送信しました。このプロフィールの通報を受け付けました');
    await expect(status.locator('svg')).toBeVisible();
    // The form closes and the private reason no longer stays on screen.
    await expect(reason).toHaveCount(0);
    await expect(
      readerPage.getByRole('button', { name: '確認したプロフィール通報を送信', exact: true }),
    ).toHaveCount(0);
    expect.soft(await seriousViolations(readerPage)).toEqual([]);
    await readerPage.screenshot({
      path: info.outputPath('profile-report-received.png'),
      fullPage: true,
      scale: 'css',
    });

    // The author edits the bio afterwards; the operator still sees what was reported.
    const edited = await author.context.request.patch('/api/private/profile', {
      headers: { Origin: 'https://127.0.0.1:8790', Authorization: 'Bearer csrf.' + author.csrf },
      data: {
        displayName: '架空の通報される投稿者-' + key,
        department: '',
        yearLabel: '',
        bio: '通報後に書き換えた自己紹介',
        confirmPublic: true,
        expectedProfile: {
          id: author.profileId,
          displayName: '架空の通報される投稿者-' + key,
          department: '',
          yearLabel: '',
          bio: '架空の自己紹介',
          initials: '架',
        },
      },
    });
    expect(edited.status()).toBe(200);

    // A server-listed operator reviews it. The header is a fixture-only stand-in for the allowlist.
    const operator = await actor(browser, contexts, '架空の運営者-' + key);
    await operator.context.setExtraHTTPHeaders({ 'X-Test-Operator-Subject': operator.subject });
    const ops = await operator.context.newPage();
    await ops.setViewportSize(page.viewportSize()!);
    await ops.goto('/moderation?type=profile');
    await ops.getByRole('button', { name: '運営セッションを確認', exact: true }).click();
    const item = ops
      .getByRole('region', { name: '通報対象の一覧' })
      .getByRole('button', { name: new RegExp('架空の通報される投稿者-' + key) });
    await item.click();
    const detail = ops.getByRole('region', { name: '選択した通報内容' });
    await expect(detail).toContainText('架空の通報理由-' + key);
    await expect(detail).toContainText('通報後に書き換えた自己紹介');
    await expect(detail).toContainText('架空の自己紹介');
    const text = await ops.locator('body').innerText();
    for (const value of [reader.subject, author.subject, 'st.kobedenshi.ac.jp'])
      expect(text).not.toContain(value);
    expect.soft(await seriousViolations(ops)).toEqual([]);
    await ops.screenshot({
      path: info.outputPath('profile-report-operator.png'),
      fullPage: true,
      scale: 'css',
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
