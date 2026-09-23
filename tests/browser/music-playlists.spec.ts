import { expect, test, type Page } from '@playwright/test';

const route = '/#/music?topParentId=library-music&collectionType=music&tab=4';
const music = (page: Page) => page.getByRole('dialog', { name: 'Music', exact: true });
const quiet = (page: Page) => page.getByRole('dialog', { name: 'Quiet moments details', exact: true });
async function patch(page: Page, source: string) {
  await page.route('**/dist/demo.js', async route => { const response = await route.fetch(); await route.fulfill({ response,
    body: `${await response.text()}\n(()=>{const api=window.TvItemLayoutDemo.api;${source}})();` }); });
}

test('album Play focus remains inside the hero with room around its highlight at TV and compact widths', async ({ page }) => {
  await patch(page, `const get=api.getItem;api.getItem=async id=>{const item=await get(id);return id==='album-tidelight'?{...item,Overview:'A long album description with enough detail to wrap across the available space. '.repeat(6)}:item;};`);
  await page.goto('/#/details?id=album-tidelight');
  const album = page.getByRole('dialog', { name: 'Tidelight details', exact: true });
  const play = album.getByRole('button', { name: 'Play album', exact: true });
  for (const width of [1440, 924]) {
    await page.setViewportSize({ width, height: 815 }); await play.focus(); await expect(play).toBeFocused();
    expect(await play.evaluate(button => {
      const box = button.getBoundingClientRect(); const hero = button.closest('.tvl-browse-hero')!.getBoundingClientRect();
      const style = getComputedStyle(button); const outline = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      return Math.min(box.left - hero.left, hero.right - box.right, box.top - hero.top, hero.bottom - box.bottom) - outline;
    })).toBeGreaterThanOrEqual(4);
    await page.screenshot({ path: test.info().outputPath(`album-focus-${width}.png`) });
  }
});

test('music playlists use cinematic listing and ordered track rows, preserve repeated songs and restore search on Back', async ({ page }) => {
  await patch(page, `api.playPlaylist=async(playlist,entryId,current)=>{if(current())document.body.dataset.playlistPlayback=JSON.stringify({id:playlist.Id,entryId:entryId||null});};`);
  await page.goto(route);
  await expect(music(page).getByRole('button', { name: 'Playlists', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(music(page).locator('[data-browse-item]')).toHaveCount(2);
  const search = music(page).getByRole('searchbox', { name: 'Search music' });
  await search.fill('Quiet'); await search.press('Enter');
  const card = music(page).getByRole('button', { name: 'Quiet moments', exact: true });
  await expect(music(page).locator('[data-browse-item]')).toHaveCount(1); await card.click();
  await expect(quiet(page).locator('.tvl-browse-tracks [data-browse-item]')).toHaveCount(3);
  await expect(quiet(page).locator('[data-browse-item="song-tidelight-1"]')).toHaveCount(2);
  await expect(quiet(page).locator('.tvl-browse-track-number')).toHaveText(['1', '2', '3']);
  await quiet(page).getByRole('button', { name: 'Play playlist', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-playlist-playback', JSON.stringify({ id: 'playlist-quiet', entryId: null }));
  await quiet(page).locator('[data-playlist-entry="quiet-entry-3"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-playlist-playback', JSON.stringify({ id: 'playlist-quiet', entryId: 'quiet-entry-3' }));
  await expect(quiet(page).getByRole('status')).toHaveText('Playback requested. Open Now playing for controls.');
  await page.screenshot({ path: test.info().outputPath('playlist-tracks.png') });
  await page.keyboard.press('Escape'); await expect(card).toBeFocused(); await expect(search).toHaveValue('Quiet');
  await expect(music(page).getByRole('button', { name: 'Playlists', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('playlist pagination retries without losing rows, then restores entry focus and loaded depth from Now playing', async ({ page }) => {
  await patch(page, `let fail=true;const entries=Array.from({length:51},(_,i)=>({Id:'song-tidelight-1',PlaylistItemId:'entry-'+i,Name:'Track '+(i+1),Type:'Audio',RunTimeTicks:1200000000}));
    api.getPlaylistItems=async(id,q={})=>{const start=q.startIndex||0;if(start===48&&fail){fail=false;throw new Error('offline');}return{items:entries.slice(start,start+(q.limit||48)),total:entries.length,nextStartIndex:Math.min(start+(q.limit||48),entries.length)};};`);
  await page.goto('/#/details?id=playlist-quiet');
  await expect(quiet(page).locator('[data-playlist-entry]')).toHaveCount(48);
  await quiet(page).getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(quiet(page).getByRole('button', { name: 'Try again', exact: true })).toBeFocused();
  await expect(quiet(page).locator('[data-playlist-entry]')).toHaveCount(48); await page.keyboard.press('Enter');
  await expect(quiet(page).locator('[data-playlist-entry]')).toHaveCount(51);
  await expect(quiet(page).locator('[data-playlist-entry="entry-48"]')).toBeFocused();
  await quiet(page).getByRole('button', { name: 'Now playing', exact: true }).click();
  await expect(page).toHaveURL(/#\/queue$/); await page.goBack();
  await expect(quiet(page).locator('[data-playlist-entry]')).toHaveCount(51);
  // The explicit Now playing control was the navigation origin.
  await expect(quiet(page).getByRole('button', { name: 'Now playing', exact: true })).toBeFocused();
});

test('playlist empty and playback error states remain usable', async ({ page }) => {
  await patch(page, `let fail=true;const get=api.getPlaylistItems;api.getPlaylistItems=async(id,q)=>{if(fail){fail=false;throw new Error('offline');}return get(id,q);};api.playPlaylist=async()=>{throw new Error('Audio output unavailable.');};`);
  await page.goto('/#/details?id=playlist-quiet');
  await expect(quiet(page).getByRole('button', { name: 'Try again', exact: true })).toBeFocused(); await page.keyboard.press('Enter');
  await expect(quiet(page).locator('[data-playlist-entry]')).toHaveCount(3);
  await quiet(page).getByRole('button', { name: 'Play playlist', exact: true }).click();
  await expect(quiet(page).getByRole('status')).toHaveText('Audio output unavailable.');
  await page.evaluate(() => { window.TvItemLayoutDemo!.api.getPlaylistItems = async () => ({ items: [], total: 0, nextStartIndex: 0 }); location.hash = '/home'; });
  await expect(quiet(page)).toHaveCount(0); await expect(page.locator('#homeTab')).toBeVisible();
  await page.evaluate(() => { location.hash = '/details?id=playlist-quiet'; });
  await expect(quiet(page).getByRole('heading', { name: 'This playlist is empty' })).toBeVisible();
  await expect(quiet(page).getByRole('button', { name: 'Play playlist', exact: true })).toBeDisabled();
  await quiet(page).getByRole('button', { name: 'Back', exact: true }).click(); await expect(page.locator('#homeTab')).toBeVisible();
});

test('late playlist contents cannot reappear after leaving their route', async ({ page }) => {
  await patch(page, `api.getPlaylistItems=async()=>{document.body.dataset.playlistLoading='true';await new Promise(resolve=>document.addEventListener('finish-playlist',resolve,{once:true}));return{items:[],total:0,nextStartIndex:0};};`);
  await page.goto('/#/details?id=playlist-quiet'); await expect(page.locator('body')).toHaveAttribute('data-playlist-loading', 'true');
  await page.evaluate(() => { location.hash = '/home'; }); await expect(page.locator('#homeTab')).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event('finish-playlist')));
  await expect(quiet(page)).toHaveCount(0); await expect(page.locator('#homeTab')).toBeVisible();
});
