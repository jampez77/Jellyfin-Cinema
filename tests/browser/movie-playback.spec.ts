import { expect, test, type Page } from '@playwright/test';

const detail = (page: Page) => page.getByRole('dialog', { name: 'After the Tide details', exact: true });

for (const layout of ['tv', 'desktop']) {
  test(`${layout} movie Resume and Play from beginning use separate positions without discarding progress`, async ({ page }) => {
    await page.goto(`/?layout=${layout}#/details?id=movie-tide`);
    const resume = detail(page).getByRole('button', { name: 'Resume', exact: true });
    const restart = detail(page).getByRole('button', { name: 'Play from beginning', exact: true });
    await expect(resume).toBeFocused(); await expect(restart).toBeVisible();
    await page.keyboard.press(layout === 'tv' ? 'ArrowRight' : 'Tab');
    await expect(restart).toBeFocused(); await page.keyboard.press('Enter');
    const player = page.getByRole('main', { name: 'Demo playback' });
    await expect(player).toContainText('Playback would start from the beginning.');
    expect(await page.evaluate(async () => (await window.TvItemLayoutDemo!.api.getItem('movie-tide')).UserData?.PlaybackPositionTicks)).toBe(28.25 * 60 * 10_000_000);
    await player.getByRole('button', { name: 'Back to details', exact: true }).click();
    await expect(restart).toBeVisible(); await resume.click();
    await expect(player).toContainText('Playback would resume at 28:15.');
  });
}

test('unstarted movies and completed movies without a resume position have only one playback action', async ({ page }) => {
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(() => {
      const api=window.TvItemLayoutDemo.api,get=api.getItem;
      api.getItem=async id=>{const item=await get(id);return id==='movie-tide'?{...item,UserData:{...item.UserData,Played:true,PlaybackPositionTicks:0}}:item;};
    })();` });
  });
  for (const id of ['movie-blue', 'movie-tide']) {
    await page.goto(`/#/details?id=${id}`);
    const root = page.locator('#tv-layout');
    await expect(root.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect(root.getByRole('button', { name: 'Resume', exact: true })).toHaveCount(0);
    await expect(root.getByRole('button', { name: 'Play from beginning', exact: true })).toHaveCount(0);
    await root.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('main', { name: 'Demo playback' })).toContainText('Playback would start from the beginning.');
  }
});

test('wrapped TV movie controls leave room around playback focus and Favourite at large and narrow widths', async ({ page }) => {
  await page.goto('/#/details?id=movie-tide');
  const actions = detail(page).locator('.tvl-actions-movie');
  await expect(actions.getByRole('button', { name: 'Play from beginning', exact: true })).toBeVisible();
  for (const width of [1920, 1280, 960, 640, 480]) {
    await page.setViewportSize({ width, height: 900 });
    const buttons = actions.locator('button');
    for (let i = 0; i < await buttons.count(); i++) {
      await buttons.nth(i).focus();
      const geometry = await buttons.nth(i).evaluate(button => {
        const style = getComputedStyle(button), rect = button.getBoundingClientRect();
        const outline = style.outlineStyle === 'none' ? 0 : Math.max(0, parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset));
        const others = Array.from(button.closest('.tvl-actions-movie')!.querySelectorAll('button')).filter(other => other !== button);
        return {
          visible: rect.left - outline >= 0 && rect.right + outline <= window.innerWidth,
          overlaps: others.filter(other => {
            const b = other.getBoundingClientRect();
            return rect.left - outline < b.right && rect.right + outline > b.left
              && rect.top - outline < b.bottom && rect.bottom + outline > b.top;
          }).map(other => other.getAttribute('aria-label') || other.textContent),
        };
      });
      expect(geometry.visible, `focused movie action ${i} stays within ${width}px`).toBe(true);
      expect(geometry.overlaps, `focused movie action ${i} has space around its outline at ${width}px`).toEqual([]);
    }
    const favourite = actions.getByRole('button', { name: 'Add to favourites', exact: true });
    await favourite.focus(); await expect(favourite).toBeFocused();
    if (width === 1280) await page.screenshot({ path: test.info().outputPath('movie-actions-tv.png') });
  }
});
