import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page, options: { admin?: boolean; held?: boolean; native?: boolean } = {}) {
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(() => {
      const state = window.__adminFixture = { admin: ${options.admin !== false}, held: ${!!options.held}, user: 'admin-a', server: 'server-a', calls: [], pending: [], menus: [], edits: [], writes: 0, holdMenus: false, menuPending: [] };
      window.ApiClient = { getCurrentUserId: () => state.user, serverId: () => state.server,
        getUser: async id => {
          state.calls.push(id); const result = { Id: id, Policy: { IsAdministrator: state.admin } };
          if (state.held) await new Promise(resolve => state.pending.push(() => resolve(result)));
          return result;
        },
        ajax: () => { state.writes++; throw new Error('The theme must not write metadata directly'); }
      };
      const api = window.TvItemLayoutDemo.api; api.serverId = 'server-a'; api.userId = 'admin-a';
      if (${options.native !== false}) {
        const host = document.createElement('div'); host.className = 'itemsContainer'; host.id = 'native-admin-items';
        host.innerHTML = '<button class="itemAction" data-id="native-existing" data-serverid="server-a">Native item</button>';
        host.addEventListener('click', event => {
          const card = event.target.closest('.itemAction[data-action="menu"]'); if (!card) return;
          event.preventDefault(); event.stopPropagation();
          state.menus.push({ id: card.dataset.id, type: card.dataset.type, server: card.dataset.serverid, play: card.dataset.playoptions });
          const bridge = card.closest('[data-tvl-admin-bridge]');
          const show = () => {
          const container = document.createElement('div'); container.className = 'dialogContainer';
          container.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0008;';
          const dialog = document.createElement('div'); dialog.className = 'dialog opened'; dialog.setAttribute('role','dialog'); dialog.setAttribute('aria-modal','true'); dialog.setAttribute('aria-label','Native item menu'); dialog.style.cssText='padding:2rem;min-width:300px;';
          for (const label of ['Edit metadata','Edit images','Refresh metadata','Identify']) {
            const action = document.createElement('button'); action.className = 'actionSheetMenuItem'; action.textContent = label;
            action.onclick = () => {
              state.edits.push({ id: card.dataset.id, action: label });
              dialog.setAttribute('aria-label',label); dialog.replaceChildren();
              const input = document.createElement('input'); input.className='emby-input'; input.setAttribute('aria-label','Native editor field');
              const cancel = document.createElement('button'); cancel.className='btnCancel';cancel.textContent='Cancel';cancel.onclick=()=>container.remove();
              const save = document.createElement('button'); save.textContent='Save';save.onclick=()=>{ bridge.notifyRefreshNeeded();container.remove(); };
              dialog.append(input,cancel,save);input.focus();
            };
            dialog.append(action);
          }
          const cancel = document.createElement('button'); cancel.className='btnCancel';cancel.textContent='Cancel';cancel.onclick=()=>container.remove();dialog.append(cancel);
          container.append(dialog);document.body.append(container);dialog.querySelector('button').focus();
          };
          if (state.holdMenus) state.menuPending.push(show); else show();
        }); document.body.append(host);
      }
    })();` });
  });
}

const manage = (page: Page, id: string) => page.locator(`#tv-layout [data-admin-item="${id}"]`).first();

test('desktop administrators open native item tools with the actual movie, show, episode, season, album, playlist and collection identity', async ({ page }) => {
  await fixture(page);
  for (const [id, type] of [['movie-tide','Movie'], ['series-north','Series'], ['episode-north-1-2','Episode'],
    ['season-north-2','Season'], ['album-tidelight','MusicAlbum'], ['playlist-quiet','Playlist'], ['collection-coast','BoxSet']]) {
    await page.goto(`/?layout=desktop&featured=0#/details?id=${id}`);
    await expect(manage(page, id)).toBeVisible(); await manage(page, id).click();
    const menu = page.getByRole('dialog', { name: 'Native item menu', exact: true });
    await expect(menu).toBeVisible();
    expect(await page.evaluate(() => (window as any).__adminFixture.menus.slice(-1))).toEqual([{ id, type, server: 'server-a', play: 'false' }]);
    await expect(menu.getByRole('button', { name: 'Refresh metadata', exact: true })).toBeVisible();
    await expect(menu).toHaveClass(/tvl-admin-native-dialog/);
    const layers = await page.evaluate(() => ({ native: Number(getComputedStyle(document.querySelector('.dialogContainer')!).zIndex), themed: Number(getComputedStyle(document.querySelector('#tv-layout')!).zIndex) }));
    expect(layers.native).toBeGreaterThan(layers.themed);
    await menu.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await page.evaluate(() => (window as any).__adminFixture.writes)).toBe(0);
  }
});

test('native editors retain text editing and refresh the themed item after a native save', async ({ page }) => {
  await fixture(page); await page.goto('/?layout=desktop&featured=0#/details?id=movie-tide');
  await manage(page, 'movie-tide').click();
  await page.getByRole('dialog', { name: 'Native item menu', exact: true }).getByRole('button', { name: 'Edit metadata', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit metadata', exact: true });
  await editor.getByRole('textbox').fill('Correct title'); await page.keyboard.press('Backspace');
  await expect(editor.getByRole('textbox')).toHaveValue('Correct titl');
  await expect(page.locator('#tv-layout')).toBeVisible();
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api, getItem = api.getItem;
    api.getItem = async id => ({ ...await getItem(id), ...(id === 'movie-tide' ? { Name: 'Updated title' } : {}) });
  });
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#tv-layout')).toHaveAttribute('aria-label', 'Updated title details');
  expect(await page.evaluate(() => (window as any).__adminFixture.edits)).toEqual([{ id: 'movie-tide', action: 'Edit metadata' }]);
  expect(await page.evaluate(() => (window as any).__adminFixture.writes)).toBe(0);
});

test('a native collection edit refreshes its title and description as well as its members', async ({ page }) => {
  await fixture(page); await page.goto('/?layout=desktop&featured=0#/details?id=collection-coast');
  await manage(page, 'collection-coast').click();
  await page.getByRole('dialog', { name: 'Native item menu', exact: true }).getByRole('button', { name: 'Edit metadata', exact: true }).click();
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api, getItem = api.getItem;
    api.getItem = async id => ({ ...await getItem(id), ...(id === 'collection-coast' ? { Name: 'Renamed collection', Overview: 'Updated description' } : {}) });
  });
  await page.getByRole('dialog', { name: 'Edit metadata', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#tv-layout')).toHaveAttribute('aria-label', 'Renamed collection collection');
  await expect(page.locator('.tvl-collection-title')).toHaveText('Renamed collection');
  await expect(page.locator('.tvl-collection-overview')).toHaveText('Updated description');
  await expect(manage(page, 'collection-coast')).toHaveAttribute('aria-label', 'Manage Renamed collection');
  await expect(page.locator('.tvl-collection-grid [data-collection-item]')).toHaveCount(2);
});

test('editing an episode preserves the selected season and reloads its episode metadata', async ({ page }) => {
  await fixture(page); await page.goto('/?layout=desktop&featured=0#/details?id=series-north');
  await page.getByRole('button', { name: 'Episodes & seasons', exact: true }).click();
  await page.locator('[data-season="season-north-2"]').click();
  await manage(page, 'episode-north-2-1').click();
  await page.getByRole('dialog', { name: 'Native item menu', exact: true }).getByRole('button', { name: 'Edit metadata', exact: true }).click();
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api, episodes = api.getEpisodes;
    api.getEpisodes = async (...args) => (await episodes(...args)).map(item => item.Id === 'episode-north-2-1' ? { ...item, Name: 'Corrected episode title' } : item);
  });
  await page.getByRole('dialog', { name: 'Edit metadata', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-season="season-north-2"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-episode="episode-north-2-1"]')).toContainText('Corrected episode title');
});

for (const [layout, admin] of [['tv', true], ['desktop', false]] as const) test(`${layout} with administrator=${admin} keeps management actions out of the UI`, async ({ page }) => {
  await fixture(page, { admin }); await page.goto(`/?layout=${layout}&featured=0#/details?id=movie-tide`);
  await expect(page.locator('#tv-layout')).toBeVisible();
  await expect(manage(page, 'movie-tide')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__adminFixture.menus)).toEqual([]);
});

test('revoked administrator access is checked on click without opening a menu', async ({ page }) => {
  await fixture(page); await page.goto('/?layout=desktop&featured=0#/details?id=movie-tide');
  await expect(manage(page, 'movie-tide')).toBeVisible();
  await page.evaluate(() => { (window as any).__adminFixture.admin = false; });
  await manage(page, 'movie-tide').click();
  await expect(manage(page, 'movie-tide')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__adminFixture.menus)).toEqual([]);
});

test('a pending native menu is dispatched once and cancellation keeps the themed detail page', async ({ page }) => {
  await page.clock.install();
  await fixture(page); await page.goto('/?layout=desktop&featured=0#/details?id=movie-tide');
  await expect(manage(page, 'movie-tide')).toBeVisible();
  await page.evaluate(() => { (window as any).__adminFixture.holdMenus = true; });
  await manage(page, 'movie-tide').click();
  await expect(manage(page, 'movie-tide')).toBeDisabled();
  await page.evaluate(() => {
    const control = document.querySelector<HTMLButtonElement>('[data-admin-item="movie-tide"]')!;
    control.click(); control.click();
    const state = (window as any).__adminFixture;
    state.holdMenus = false; state.menuPending.splice(0).forEach((show: () => void) => show());
  });
  const menu = page.getByRole('dialog', { name: 'Native item menu', exact: true });
  await expect(menu).toBeVisible(); await expect(manage(page, 'movie-tide')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__adminFixture.menus)).toHaveLength(1);
  await menu.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.clock.fastForward(2_500);
  await expect(page.locator('#tv-layout')).toBeVisible();
  await expect(page.locator('[data-tvl-admin-bridge]')).toHaveCount(0);
});

for (const change of ['account', 'layout'] as const) test(`a delayed admin check cannot open a menu after the ${change} changes`, async ({ page }) => {
  await fixture(page); await page.goto('/?layout=desktop&featured=0#/details?id=movie-tide');
  await expect(manage(page, 'movie-tide')).toBeVisible();
  await page.evaluate(() => { (window as any).__adminFixture.held = true; });
  await manage(page, 'movie-tide').click();
  await expect.poll(() => page.evaluate(() => (window as any).__adminFixture.pending.length)).toBeGreaterThan(0);
  await page.evaluate(change => {
    const state = (window as any).__adminFixture;
    if (change === 'account') { state.user = 'someone-else'; }
    else { document.body.classList.remove('layout-desktop'); document.body.classList.add('layout-tv'); }
    state.held = false; state.pending.splice(0).forEach((resolve: () => void) => resolve());
  }, change);
  await expect(manage(page, 'movie-tide')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__adminFixture.menus)).toEqual([]);
});

test('switching to TV closes an already open native management dialog', async ({ page }) => {
  await fixture(page); await page.goto('/?layout=desktop&featured=0#/details?id=movie-tide');
  await manage(page, 'movie-tide').click();
  await expect(page.getByRole('dialog', { name: 'Native item menu', exact: true })).toBeVisible();
  await page.evaluate(() => { document.body.classList.remove('layout-desktop'); document.body.classList.add('layout-tv'); });
  await expect(page.getByRole('dialog', { name: 'Native item menu', exact: true })).toHaveCount(0);
  await expect(manage(page, 'movie-tide')).toBeHidden();
});

test('native desktop action sheets without Cancel use their backdrop close handler', async ({ page }) => {
  await fixture(page); await page.goto('/?layout=desktop&featured=0#/details?id=movie-tide');
  await manage(page, 'movie-tide').click();
  await expect(page.getByRole('dialog', { name: 'Native item menu', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>('.dialogContainer')!;
    container.querySelector('.btnCancel')!.remove();
    let pressed: EventTarget | null;
    container.addEventListener('mousedown', event => { pressed = event.target; });
    container.addEventListener('click', event => { if (event.target === container && pressed === container) container.remove(); });
    document.body.classList.remove('layout-desktop'); document.body.classList.add('layout-tv');
  });
  await expect(page.getByRole('dialog', { name: 'Native item menu', exact: true })).toHaveCount(0);
});

test('an unavailable native shortcut opens the matching original item page without changing its metadata', async ({ page }) => {
  await fixture(page, { native: false }); await page.goto('/?layout=desktop&featured=0#/details?id=movie-tide');
  await manage(page, 'movie-tide').click();
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/details\?id=movie-tide&serverId=server-a$/);
  expect(await page.evaluate(() => (window as any).__adminFixture.writes)).toBe(0);
  await expect(page.locator('[data-tvl-admin-bridge]')).toHaveCount(0);
});
