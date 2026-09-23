import { expect, test, type Page } from '@playwright/test';

/** The native Recordings library tile uses a generic parentId list route, even
 * for an empty CollectionFolder; it does not add type=Recordings. */
async function folders(page: Page, empty = false): Promise<void> {
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(() => {
      const api = window.TvItemLayoutDemo.api;
      const getItem = api.getItem, getRecordings = api.getRecordings;
      const ids = ['recording-library', 'recorded-series', 'ordinary-library'];
      api.getItem = async id => ids.includes(id) ? {Id:id, Name:'Recordings', Type:'CollectionFolder', IsFolder:true} : getItem(id);
      api.isRecordingFolder = async id => {
        document.body.dataset.recordingFolderChecked = id;
        return id === 'recording-library' || id === 'recorded-series';
      };
      api.getRecordings = async query => {
        document.body.dataset.recordingParent = query.parentId || '';
        const page = await getRecordings(query);
        const items = ${empty} ? [] : page.items.filter(item => query.parentId !== 'recorded-series' || item.Id === 'recording-mountain');
        return {items, total:items.length, nextStartIndex:items.length};
      };
      function nativeFolder() {
        const parent = new URLSearchParams(location.hash.split('?')[1]).get('parentId');
        if (!ids.includes(parent)) return;
        const host = document.querySelector('.demo-native-page');
        host.classList.add('mainAnimatedPage', 'libraryPage');
        host.setAttribute('data-role', 'page');
        host.innerHTML = '<h1>Recordings</h1><div class="itemsContainer" data-parentid="'+parent+'">0–0 of 0</div>';
      }
      window.addEventListener('hashchange', nativeFolder); nativeFolder();
    })();` });
  });
}

test('the native empty Recordings library opens Cinema with DVR navigation intact', async ({ page }) => {
  await folders(page, true);
  await page.goto('/#/list?parentId=recording-library&serverId=demo');
  const recordings = page.getByRole('dialog', { name: 'Recordings', exact: true });
  await expect(recordings).toBeVisible();
  await expect(recordings.locator('[data-browse-item]')).toHaveCount(0);
  await expect(page.locator('body')).toHaveAttribute('data-recording-parent', 'recording-library');
  await expect(page.locator('.demo-native-page')).toHaveAttribute('aria-hidden', 'true');
  await recordings.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(page).toHaveURL(/#\/livetv\?tab=4&serverId=demo$/);
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await expect(page.locator('body')).toHaveAttribute('data-tvl-recording-page', 'schedule');
});

test('a recording subfolder stays scoped through filters, details and Back', async ({ page }) => {
  await folders(page);
  await page.goto('/#/home');
  await page.evaluate(() => { location.hash = '#/list?parentId=recorded-series'; });
  const recordings = page.getByRole('dialog', { name: 'Recordings', exact: true });
  await expect(recordings.locator('[data-browse-item]')).toHaveCount(1);
  await expect(page.locator('body')).toHaveAttribute('data-recording-parent', 'recorded-series');
  await recordings.getByRole('button', { name: 'Completed', exact: true }).click();
  const recording = recordings.getByRole('button', { name: 'Wild Horizons: Above the Clouds', exact: true });
  await recording.click();
  await expect(page.getByRole('dialog', { name: 'Above the Clouds details', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(recordings.getByRole('button', { name: 'Completed', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(recording).toBeFocused();
  await expect(recordings.locator('[data-browse-item]')).toHaveCount(1);
});

test('an unrelated library named Recordings retains its native page', async ({ page }) => {
  await folders(page);
  await page.goto('/#/list?parentId=ordinary-library');
  await expect(page.locator('body')).toHaveAttribute('data-recording-folder-checked', 'ordinary-library');
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await expect(page.locator('.demo-native-page').getByRole('heading', { name: 'Recordings', exact: true })).toBeVisible();
  await expect(page.locator('.demo-native-page')).not.toHaveAttribute('aria-hidden', 'true');
});

test('recording folder recognition cannot reopen a page after navigation away', async ({ page }) => {
  await folders(page);
  await page.goto('/#/home');
  await page.evaluate(() => {
    window.TvItemLayoutDemo!.api.isRecordingFolder = async () => {
      document.body.dataset.recordingProbeWaiting = 'true';
      await new Promise(resolve => document.addEventListener('finish-recording-probe', resolve, { once: true }));
      return true;
    };
    location.hash = '#/list?parentId=recording-library';
  });
  await expect(page.locator('body')).toHaveAttribute('data-recording-probe-waiting', 'true');
  await page.evaluate(() => { location.hash = '#/home'; });
  await expect(page.locator('#homeTab')).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event('finish-recording-probe')));
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await expect(page.locator('#homeTab')).toBeVisible();
});

test('recording library enhancement follows TV mode and restores its native host', async ({ page }) => {
  await folders(page);
  await page.goto('/#/list?parentId=recording-library');
  await expect(page.getByRole('dialog', { name: 'Recordings', exact: true })).toBeVisible();
  await page.evaluate(() => { document.documentElement.classList.remove('layout-tv'); document.body.classList.remove('layout-tv'); });
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await expect(page.locator('.demo-native-page')).not.toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.demo-native-page')).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.add('layout-tv'));
  await expect(page.getByRole('dialog', { name: 'Recordings', exact: true })).toBeVisible();
});
