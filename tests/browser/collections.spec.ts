import { test, expect } from '@playwright/test';

test('series overview scrolls through collections and recommendations with a remote', async ({ page }) => {
  await page.goto('/#/details?id=series-north');
  const root = page.locator('#tv-layout');
  const collections = root.getByRole('region', { name:'Collections', exact:true });
  const more = root.getByRole('region', { name:'More like this', exact:true });
  await expect(collections.getByRole('button', { name:'Open collection: Into the Wilderness' })).toBeAttached();
  await expect(more.locator('.tvl-film-card')).toHaveCount(5);
  await root.getByRole('button', { name:'Add to favourites', exact:true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(collections.getByRole('button')).toBeFocused();
  await expect(collections.getByRole('button')).toBeInViewport();
  await page.keyboard.press('ArrowDown');
  await expect(more.locator('.tvl-film-card').first()).toBeFocused();
  await expect(more.locator('.tvl-film-card').first()).toBeInViewport();
  await expect.poll(()=>root.locator('.tvl-content').evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/id=movie-tide$/);
});

for (const [id, collection] of [['movie-tide','Coastal Stories'],['series-north','Into the Wilderness']]) {
  test(`${id} opens its collection through Jellyfin's native collection route`, async ({ page }) => {
    await page.goto(`/#/details?id=${id}&serverId=test-server`);
    await page.getByRole('button', { name:`Open collection: ${collection}` }).click();
    await expect(page).toHaveURL(/#\/details\?id=collection-.*&serverId=test-server$/);
    await expect(page.locator('#tv-layout')).toHaveCount(0);
    await expect(page.locator('.itemDetailPage')).not.toHaveAttribute('aria-hidden','true');
    await expect(page.getByRole('heading', { name:collection, exact:true })).toBeVisible();
    await expect(page.locator('.demo-collection-grid a')).toHaveCount(id === 'movie-tide' ? 2 : 3);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`id=${id}&serverId=test-server$`));
    await expect(page.locator('#tv-layout')).toHaveAttribute('data-pane','overview');
  });
}

test('empty membership hides collections without hiding recommendations', async ({ page }) => {
  await page.goto('/#/details?id=movie-silence');
  await expect(page.locator('#tv-layout .tvl-film-card')).toHaveCount(4);
  await expect(page.getByRole('region', { name:'Collections', exact:true })).toHaveCount(0);
  await expect(page.getByRole('region', { name:'More like this', exact:true })).toBeAttached();
});

test('collection errors are isolated and retry restores focus into the results', async ({ page }) => {
  await page.goto('/#/details?id=movie-silence');
  await expect(page.locator('#tv-layout')).toHaveAttribute('data-pane','overview');
  await page.evaluate(()=>{
    const api=window.TvItemLayoutDemo!.api;
    const original=api.getCollections;
    let failed=false;
    api.getCollections=async(id)=>{ if (!failed) { failed=true; throw new Error('offline'); } return original(id); };
    location.hash='/details?id=movie-tide';
  });
  const collections = page.getByRole('region', { name:'Collections', exact:true });
  await expect(collections).toContainText('Collections could not be loaded.');
  await expect(page.getByRole('region', { name:'More like this', exact:true }).locator('.tvl-film-card')).toHaveCount(4);
  await collections.getByRole('button', { name:'Try again' }).click();
  await expect(collections.getByRole('button', { name:'Open collection: Coastal Stories' })).toBeFocused();
  await expect(collections).not.toContainText('Collections could not be loaded.');
});

test('late membership cannot repopulate a different detail pane', async ({ page }) => {
  await page.goto('/#/details?id=movie-silence');
  await expect(page.locator('#tv-layout')).toHaveAttribute('data-pane','overview');
  await page.evaluate(()=>{
    const api=window.TvItemLayoutDemo!.api;
    const original=api.getCollections;
    api.getCollections=async(id)=>{
      await new Promise<void>(resolve=>document.addEventListener('release-collections',()=>resolve(),{once:true}));
      const result=await original(id);
      document.dispatchEvent(new Event('collections-settled'));
      return result;
    };
    location.hash='/details?id=movie-tide';
  });
  await expect(page.locator('#tv-layout')).toHaveAttribute('aria-label','After the Tide details');
  await expect(page.locator('#tv-layout .tvl-collections')).toHaveAttribute('aria-busy','true');
  await page.getByRole('button', { name:'More like this', exact:true }).click();
  await page.evaluate(()=>new Promise<void>(resolve=>{
    document.addEventListener('collections-settled',()=>resolve(),{once:true});
    document.dispatchEvent(new Event('release-collections'));
  }));
  await expect(page.locator('#tv-layout')).toHaveAttribute('data-pane','similar');
  await expect(page.getByRole('region', { name:'Collections', exact:true })).toHaveCount(0);
});
