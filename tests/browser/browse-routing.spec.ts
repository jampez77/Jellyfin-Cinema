import { expect, test } from '@playwright/test';

test('a recorded movie opens its full movie details when subsequently selected from Movies', async ({ page }) => {
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(() => {
      const api = window.TvItemLayoutDemo.api;
      api.getRecordings = async () => ({ items:[await api.getItem('movie-tide')], total:1, nextStartIndex:1 });
    })();` });
  });
  await page.goto('/#/livetv?tab=3&collectionType=livetv');
  await page.getByRole('dialog', {name:'Recordings', exact:true}).getByRole('button', {name:'After the Tide', exact:true}).click();
  await expect(page.locator('.tvl-browse-view')).toHaveAttribute('data-pane','recordings');
  await page.getByRole('navigation', {name:'Preview media type'}).getByRole('link', {name:'Movies', exact:true}).click();
  await page.getByRole('dialog', {name:'Movies', exact:true}).getByRole('button', {name:'All movies', exact:true}).click();
  await page.getByRole('dialog', {name:'Movies', exact:true}).getByRole('button', {name:'After the Tide', exact:true}).click();
  await expect(page.getByRole('dialog', {name:'After the Tide details', exact:true}).getByRole('button', {name:'Watch trailer', exact:true})).toBeVisible();
  await expect(page.locator('.tvl-browse-view')).toHaveCount(0);
});
