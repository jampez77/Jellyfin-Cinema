import { test, expect } from '@playwright/test';

test('movie collection picker adds existing membership, searches, and restores action focus', async ({ page }) => {
  await page.goto('/#/details?id=movie-tide');
  const add = page.getByRole('button', { name:'Add to collection', exact:true });
  await add.click();
  const picker = page.getByRole('dialog', { name:'Add to collection', exact:true });
  const choice = picker.getByRole('button', { name:'Add to Into the Wilderness', exact:true });
  await expect(choice).toBeFocused();
  await expect(picker.getByRole('button', { name:'Coastal Stories, already in collection' })).toBeDisabled();
  const search = picker.getByRole('searchbox', { name:'Find a collection' });
  await search.fill('nothing');
  await expect(picker).toContainText('No matching collections.');
  await search.fill('wilderness');
  await page.keyboard.press('ArrowDown');
  await expect(choice).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(add).toBeFocused();
  await expect(page.locator('#tv-layout').getByRole('status')).toHaveText('Added to Into the Wilderness');
  await expect(page.getByRole('button', { name:'Open collection: Into the Wilderness' })).toBeVisible();
  await add.click();
  await expect(picker.getByRole('button', { name:'Into the Wilderness, already in collection' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(add).toBeFocused();
});

test('show collection creation keeps remote text editing and adds the show to the new collection', async ({ page }) => {
  await page.goto('/#/details?id=series-north');
  const add = page.getByRole('button', { name:'Add to collection', exact:true });
  await add.click();
  const picker = page.getByRole('dialog', { name:'Add to collection', exact:true });
  await picker.getByRole('button', { name:'Create new collection', exact:true }).click();
  const name = picker.getByRole('textbox', { name:'Collection name', exact:true });
  await expect(name).toBeFocused();
  await name.fill('Weekend favourites!');
  await page.keyboard.press('Backspace');
  await expect(name).toHaveValue('Weekend favourites');
  await page.keyboard.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(add).toBeFocused();
  await expect(page.getByRole('button', { name:'Open collection: Weekend favourites' })).toBeVisible();
  const members = await page.evaluate(async () => {
    const api = window.TvItemLayoutDemo!.api;
    const created = (await api.getCollectionList()).find(item=>item.Name==='Weekend favourites')!;
    return (await api.getCollectionItems(created.Id)).map(item=>item.Id);
  });
  expect(members).toEqual(['series-north']);
});

test('collection write errors leave a retryable choice without duplicate remote submits', async ({ page }) => {
  await page.goto('/#/details?id=movie-tide');
  await page.evaluate(() => {
    const api=window.TvItemLayoutDemo!.api; const original=api.addToCollection!;
    let calls=0;
    api.addToCollection=async(...args)=>{ if (++calls===1) throw new Error('Collection could not be saved. Try again.'); await original(...args); };
  });
  await page.getByRole('button', { name:'Add to collection', exact:true }).click();
  const picker = page.getByRole('dialog', { name:'Add to collection', exact:true });
  const choice = picker.getByRole('button', { name:'Add to Into the Wilderness', exact:true });
  await choice.click();
  await expect(picker.getByRole('status')).toHaveText('Collection could not be saved. Try again.');
  await expect(choice).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole('button', { name:'Open collection: Into the Wilderness' })).toBeVisible();
});

test('cancelled collection loading cannot reopen the picker or steal focus', async ({ page }) => {
  await page.goto('/#/details?id=movie-tide');
  await page.evaluate(() => {
    const api=window.TvItemLayoutDemo!.api; const original=api.getCollectionList;
    api.getCollectionList=async(...args)=>{
      document.documentElement.dataset.pickerPending='true';
      await new Promise<void>(resolve=>document.addEventListener('release-picker',()=>resolve(),{once:true}));
      const items=await original(...args); document.dispatchEvent(new Event('picker-settled')); return items;
    };
  });
  const add = page.getByRole('button', { name:'Add to collection', exact:true });
  await add.click();
  const picker = page.getByRole('dialog', { name:'Add to collection', exact:true });
  await expect(picker.getByText('Loading collections…')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-picker-pending','true');
  await page.keyboard.press('Escape');
  await expect(add).toBeFocused();
  await page.evaluate(()=>new Promise<void>(resolve=>{
    document.addEventListener('picker-settled',()=>resolve(),{once:true}); document.dispatchEvent(new Event('release-picker'));
  }));
  await expect(picker).toHaveCount(0);
  await expect(add).toBeFocused();
});

test('accounts without collection management do not get an editing action', async ({ page }) => {
  await page.goto('/#/details?id=movie-tide');
  await expect(page.getByRole('button', { name:'Add to collection', exact:true })).toBeVisible();
  await page.evaluate(()=>{
    window.TvItemLayoutDemo!.api.canManageCollections=async()=>false;
    location.hash='/details?id=series-north';
  });
  await expect(page.locator('#tv-layout')).toHaveAttribute('aria-label','North of Nowhere details');
  await expect(page.getByRole('button', { name:'Add to collection', exact:true })).toHaveCount(0);
  await expect(page.getByRole('button', { name:'Open collection: Into the Wilderness' })).toBeAttached();
});

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
  test(`${id} opens its styled collection and restores entry focus on Back`, async ({ page }) => {
    await page.goto(`/#/details?id=${id}&serverId=test-server`);
    await page.getByRole('button', { name:`Open collection: ${collection}` }).click();
    await expect(page).toHaveURL(/#\/details\?id=collection-.*&serverId=test-server$/);
    const root=page.getByRole('dialog',{name:`${collection} collection`,exact:true});
    await expect(root).toBeVisible();
    await expect(page.locator('.itemDetailPage')).toHaveAttribute('aria-hidden','true');
    await expect(root.getByRole('heading', { name:collection, exact:true })).toBeVisible();
    await expect(root.locator('[data-collection-item]')).toHaveCount(id === 'movie-tide' ? 2 : 3);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(new RegExp(`id=${id}&serverId=test-server$`));
    await expect(page.locator('#tv-layout')).toHaveAttribute('data-pane','overview');
    await expect(page.getByRole('button',{name:`Open collection: ${collection}`})).toBeFocused();
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
