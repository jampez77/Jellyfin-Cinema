import { expect, test, type Page } from '@playwright/test';

const music = (page: Page) => page.getByRole('dialog', { name: 'Music', exact: true });
const legacy = '#/list?parentId=library-playlists&serverId=playlist-server';
const modern = '#/playlists?topParentId=library-playlists&collectionType=playlists&serverId=playlist-server';

async function patch(page: Page, source = '') {
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(() => {
      const api=window.TvItemLayoutDemo.api; api.userId='playlist-user'; api.serverId='playlist-server';
      const getItem=api.getItem; let probes=0;
      api.getItem=async id=>{if(id==='library-playlists')document.body.dataset.playlistProbes=String(++probes);return getItem(id);};
      function legacyHost() {
        if(!location.hash.startsWith('#/list?parentId=library-playlists'))return;
        const host=document.querySelector('.demo-native-page');
        host.classList.remove('mainAnimatedPage'); host.dataset.role='page';
      }
      window.addEventListener('hashchange',legacyHost); legacyHost();
      ${source}
    })();` });
  });
}

for (const layout of ['tv', 'desktop']) {
  test(`My Media playlist library uses Cinema and restores search, playback and Back focus on ${layout}`, async ({ page }) => {
    await patch(page, `api.playPlaylist=async(playlist,entryId,current)=>{if(current())document.body.dataset.playlistPlayback=JSON.stringify({id:playlist.Id,entryId:entryId||null});};`);
    await page.goto(`/?featured=0&layout=${layout}&libraryOrder=library-playlists#/home`);
    const tile = page.locator('#homeTab').getByRole('button', { name: 'Playlists', exact: true });
    await tile.click();
    await expect(page).toHaveURL(/#\/list\?parentId=library-playlists$/);
    await expect(music(page).getByRole('button', { name: 'Playlists', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(music(page).locator('[data-browse-item]')).toHaveCount(2);
    await expect(page.locator('.demo-native-page')).toHaveAttribute('aria-hidden', 'true');
    const search = music(page).getByRole('searchbox', { name: 'Search music' });
    await search.fill('Quiet'); await search.press('Enter');
    const card = music(page).getByRole('button', { name: 'Quiet moments', exact: true });
    await card.click();
    await expect(page).toHaveURL(/#\/details\?id=playlist-quiet&serverId=playlist-server$/);
    const details = page.getByRole('dialog', { name: 'Quiet moments details', exact: true });
    await expect(details.locator('[data-playlist-entry]')).toHaveCount(3);
    await details.locator('[data-playlist-entry="quiet-entry-3"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-playlist-playback', JSON.stringify({ id: 'playlist-quiet', entryId: 'quiet-entry-3' }));
    await page.keyboard.press('Escape');
    await expect(card).toBeFocused(); await expect(search).toHaveValue('Quiet');
    await expect(page.locator('body')).toHaveAttribute('data-playlist-probes', '1');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/#\/home$/); await expect(tile).toBeFocused();
    await expect(page.locator('#tv-layout')).toHaveCount(0);
    await expect(page.locator('.demo-native-page')).not.toHaveAttribute('aria-hidden', 'true');
  });
}

test('standalone modern playlist navigation opens the same list and masks a late native host', async ({ page }) => {
  await patch(page);
  await page.goto('/?featured=0&layout=desktop#/home');
  // Jellyfin's modern navigation uses the standalone playlist route.
  await page.evaluate(hash => {
    const link = document.createElement('a'); link.href = hash; link.textContent = 'Playlists';
    document.querySelector('.demo-home-globals')!.append(link);
  }, modern);
  await page.locator('.demo-home-globals').getByRole('link', { name: 'Playlists', exact: true }).click();
  await expect(music(page).getByRole('button', { name: 'Playlists', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(music(page).locator('[data-browse-item]')).toHaveCount(2);
  await page.locator('#playlistsPage').evaluate(old => {
    const replacement = document.createElement('main'); replacement.id = old.id;
    replacement.className = 'mainAnimatedPage libraryPage replacement-playlists';
    replacement.textContent = 'Native playlists'; old.replaceWith(replacement);
  });
  await expect(page.locator('.replacement-playlists')).toHaveAttribute('aria-hidden', 'true');
  await expect(page).toHaveURL(new RegExp(`${modern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  await music(page).getByRole('button', { name: 'Now playing', exact: true }).click();
  await expect(page).toHaveURL(/#\/queue\?serverId=playlist-server$/);
  await expect(page.locator('.replacement-playlists')).not.toHaveAttribute('aria-hidden', 'true');
  await page.goBack();
  await expect(music(page).getByRole('button', { name: 'Now playing', exact: true })).toBeFocused();
});

test('playlist favourites, unknown filters and unrelated folders keep their native routing', async ({ page }) => {
  await patch(page);
  await page.goto(`/${legacy}`);
  await expect(music(page)).toBeVisible();
  for (const hash of [
    `${modern}&tab=1`, `${modern}&tab=99`, `${modern}&filter=IsFavorite`,
    '#/playlists?collectionType=movies', `${legacy}&filter=IsFavorite`,
    '#/list?parentId=library-movies', '#/list?parentId=library-playlists&type=Audio',
  ]) {
    await page.evaluate(hash => { location.hash = hash; }, hash);
    await expect(page.locator('#tv-layout')).toHaveCount(0);
    await expect(page.locator('.demo-native-page')).not.toHaveAttribute('aria-hidden', 'true');
  }
});

test('playlist root classifications and saved search do not cross accounts', async ({ page }) => {
  await patch(page);
  await page.goto(`/${legacy}`);
  const search = music(page).getByRole('searchbox', { name: 'Search music' });
  await search.fill('Quiet'); await search.press('Enter');
  await expect(music(page).locator('[data-browse-item]')).toHaveCount(1);
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api;
    api.userId = 'second-account';
    api.getItem = async id => ({ Id: id, Name: 'Other library', Type: 'CollectionFolder', CollectionType: 'movies', IsFolder: true });
    window.TvItemLayout!.refresh();
  });
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await expect(page.locator('.demo-native-page')).not.toHaveAttribute('aria-hidden', 'true');
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api;
    api.userId = 'third-account';
    api.getItem = async id => ({ Id: id, Name: 'Playlists', Type: 'UserView', CollectionType: 'playlists' });
    window.TvItemLayout!.refresh();
  });
  await expect(search).toHaveValue('');
  await expect(music(page).locator('[data-browse-item]')).toHaveCount(2);
});

test('a late playlist root probe cannot reopen the list after navigating away', async ({ page }) => {
  await patch(page, `api.getItem=async id=>{document.body.dataset.playlistProbeWaiting='true';await new Promise(resolve=>document.addEventListener('release-playlist-root',resolve,{once:true}));document.body.dataset.playlistProbeReleased='true';return {Id:id,Name:'Playlists',Type:'UserView',CollectionType:'playlists'};};`);
  await page.goto(`/${legacy}`);
  await expect(page.locator('body')).toHaveAttribute('data-playlist-probe-waiting', 'true');
  await page.evaluate(() => { location.hash = '#/queue'; });
  await expect(page).toHaveURL(/#\/queue$/);
  await page.evaluate(() => document.dispatchEvent(new Event('release-playlist-root')));
  await expect(page.locator('body')).toHaveAttribute('data-playlist-probe-released', 'true');
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await expect(page.locator('.demo-native-page')).not.toHaveAttribute('aria-hidden', 'true');
});
