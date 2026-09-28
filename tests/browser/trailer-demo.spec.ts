import { expect, test } from '@playwright/test';

test('Cinema preview saves the advertised film and advances one trailer at a time', async ({ page }) => {
  await page.goto('/?scenario=cinema-trailers#/video');
  const actions = page.locator('#tvl-trailer-actions');
  await expect(actions).toBeVisible();
  await expect(actions).toHaveAttribute('data-movie-id', 'movie-silence');
  await expect(page.locator('.demo-cinema-copy h1')).toHaveText('The Shape of Silence');
  await page.locator('.btnPause').press('ArrowUp');
  await expect(actions.getByRole('button', { name:'Add to watchlist' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(actions.getByRole('button', { name:'In watchlist' })).toBeDisabled();
  await expect(actions.getByRole('status')).toContainText('The Shape of Silence added');
  await page.screenshot({ path:test.info().outputPath('cinema-trailer-preview.png') });
  await actions.getByRole('button', { name:'Skip trailer' }).click();
  await expect(actions).toHaveAttribute('data-movie-id', 'movie-higher');
  await expect(page.locator('.demo-cinema-player')).toHaveAttribute('data-cinema-index', '1');
  await expect(page.locator('.demo-cinema-copy h1')).toHaveText('Higher Ground');
  await actions.getByRole('button', { name:'Skip trailer' }).click();
  await expect(page.locator('.demo-cinema-player')).toHaveAttribute('data-cinema-index', '2');
  await expect(page.locator('.demo-cinema-copy h1')).toHaveText('After the Tide');
  await expect(actions).toHaveCount(0);
  await page.getByRole('link', { name:'View watchlist' }).click();
  await expect(page.getByRole('dialog', { name:'Watchlist details', exact:true })).toBeVisible();
  await expect(page.getByRole('button', { name:'Play The Shape of Silence', exact:true })).toBeVisible();
  await expect(page.getByRole('button', { name:'Play After the Tide', exact:true })).toHaveCount(0);
  await expect(page.locator('video.htmlvideoplayer')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name:'Play The Shape of Silence', exact:true })).toBeVisible();
});

test('Cinema preview stops its stream when leaving and does not replace ordinary playback', async ({ page }) => {
  await page.goto('/?scenario=cinema-trailers#/video');
  await expect(page.locator('#tvl-trailer-actions')).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __demoStream:MediaStream }).__demoStream = document.querySelector<HTMLVideoElement>('video.htmlvideoplayer')!.srcObject as MediaStream;
  });
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/details\?id=movie-tide$/);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __demoStream:MediaStream }).__demoStream.getTracks().map(track => track.readyState))).toEqual(['ended']);
  await expect(page.locator('#videoOsdPage')).toHaveCount(0);
  await page.goto('/#/details?id=movie-tide');
  await page.getByRole('button', { name:/^Resume/ }).click();
  await expect(page.getByRole('dialog', { name:'Playback controls' })).toBeVisible();
  await expect(page.locator('#videoOsdPage')).toHaveCount(0);
  await expect(page.locator('#tvl-trailer-actions')).toHaveCount(0);
});
