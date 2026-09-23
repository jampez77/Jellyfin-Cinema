import { expect, test, type Page } from '@playwright/test';

/** Shapes and native event ownership from Jellyfin Web's livetv.html,
 * mainTabsManager and recordingeditor.template.html (10.11 and 12). */
async function nativeSchedule(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('#liveTvSuggestedPage')!;
    host.className = 'page libraryPage liveTvPage';
    host.innerHTML = `<div class="liveTvContainer">
      <div class="pageTabContent is-active" id="scheduleTab" data-index="4">
        <div id="upcomingRecordings"><div class="recordingItems"><div class="verticalSection">
          <h2 class="sectionTitle padded-left">Tomorrow</h2>
          <div class="itemsContainer padded-left padded-right">
            <button type="button" class="card" data-native-timer="timer-1"><div class="cardBox"><div class="cardScalable"><div class="cardImageContainer"></div></div><div class="cardFooter"><div class="cardText">Wild Horizons</div><div class="cardText cardText-secondary">Tomorrow · 20:00</div></div></div></button>
          </div></div></div></div>
      </div>
      <div class="pageTabContent" id="seriesTab" data-index="5" hidden><div class="itemsContainer"><a class="card" href="#/details?seriesTimerId=series-timer-1&serverId=demo"><div class="cardBox"><div class="cardText">Wild Horizons series</div></div></a></div></div>
    </div>`;
    const header = document.createElement('header');
    header.className = 'skinHeader'; header.dataset.nativeDvrHeader = '';
    header.innerHTML = '<nav class="headerTabs"><div is="emby-tabs"><button type="button" class="emby-tab-button emby-tab-button-active" data-index="4">Schedule</button><button type="button" class="emby-tab-button" data-index="5">Series</button><button type="button" class="emby-tab-button" data-index="2">Channels</button></div></nav>';
    host.before(header);
    header.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.addEventListener('click', () => {
      const index = button.dataset.index!;
      header.querySelectorAll('button').forEach(other => other.classList.toggle('emby-tab-button-active', other === button));
      host.querySelectorAll<HTMLElement>('.pageTabContent').forEach(panel => { panel.hidden = panel.dataset.index !== index; panel.classList.toggle('is-active', !panel.hidden); });
      button.parentElement!.dispatchEvent(new CustomEvent('tabchange', { bubbles: true, detail: { selectedTabIndex: Number(index) } }));
    }));
    const timer = host.querySelector<HTMLButtonElement>('[data-native-timer]')!;
    timer.addEventListener('click', () => {
      document.body.dataset.nativeEditCount = String(Number(document.body.dataset.nativeEditCount || 0) + 1);
      const container = document.createElement('div'); container.className = 'dialogContainer';
      container.innerHTML = `<div class="dialog opened recordingDialog" role="dialog" aria-modal="true" aria-label="Recording options"><div class="formDialogHeader"><h3>Recording options</h3></div><div class="formDialogContent"><div class="dialogContentInner"><form><label>Start early <input class="emby-input" type="number" min="0" value="2"></label><div class="fieldDescription">Minutes before</div><div class="formDialogFooter"><button type="submit" class="raised button-submit formDialogFooterItem" disabled>Save</button><button type="button" class="raised button-cancel btnCancelRecording formDialogFooterItem" hidden>Cancel recording</button><button type="button" class="raised btnCancel formDialogFooterItem">Back</button></div></form></div></div></div>`;
      const close = () => { container.remove(); timer.focus(); };
      container.querySelector<HTMLButtonElement>('.btnCancel')!.addEventListener('click', close);
      container.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
      document.body.append(container);
      container.querySelector<HTMLInputElement>('input')!.focus();
    });
  });
}

test('Schedule keeps native editing, permissions and focus while adopting Cinema styling', async ({ page }) => {
  await page.goto('/#/livetv?tab=4&serverId=demo');
  await nativeSchedule(page);
  await expect(page.locator('body')).toHaveAttribute('data-tvl-recording-page', 'schedule');
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  const timer = page.locator('[data-native-timer]');
  await timer.focus();
  await expect(timer.locator('.cardBox')).toHaveCSS('outline-style', 'solid');
  await expect(timer.locator('.cardFooter')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.keyboard.press('Enter');
  const editor = page.getByRole('dialog', { name: 'Recording options' });
  await expect(editor).toHaveCSS('background-color', 'rgb(16, 17, 18)');
  await expect(editor.getByRole('spinbutton')).toBeFocused();
  await expect(editor.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(editor.locator('.btnCancelRecording')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-native-edit-count', '1');
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(timer).toBeFocused();
});

test('native tab changes keep Series styled without rewriting the URL or consuming controls', async ({ page }) => {
  await page.goto('/#/livetv?tab=4&serverId=demo');
  await nativeSchedule(page);
  await page.locator('[data-native-dvr-header]').getByRole('button', { name: 'Series', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-tvl-recording-page', 'series');
  await expect(page).toHaveURL(/tab=4&serverId=demo$/);
  const series = page.getByRole('link', { name: 'Wild Horizons series', exact: true });
  await expect(series).toBeVisible();
  await expect(series).toHaveAttribute('href', '#/details?seriesTimerId=series-timer-1&serverId=demo');
  await page.locator('[data-native-dvr-header]').getByRole('button', { name: 'Channels', exact: true }).click();
  await expect(page.locator('body')).not.toHaveClass(/tvl-recordings-native/);
  await expect(page.locator('body')).not.toHaveAttribute('data-tvl-recording-page');
});

test('direct series timer details keep native form state and controls', async ({ page }) => {
  await page.goto('/#/details?seriesTimerId=series-timer-1&serverId=demo');
  await page.evaluate(() => {
    const page = document.querySelector<HTMLElement>('.demo-native-page')!;
    page.id = 'itemDetailPage'; page.className = 'page libraryPage itemDetailPage';
    page.innerHTML = '<div class="detailRibbon"><div class="nameContainer"><h1 class="itemName">Wild Horizons</h1></div></div><div class="seriesRecordingEditor"><form><label>Record <select class="emby-select"><option>New episodes only</option><option>All episodes</option></select></label><button type="submit" class="raised button-submit">Save</button><button type="button" class="btnCancelSeriesTimer" hidden>Cancel series</button></form></div><section id="seriesTimerScheduleSection" style="margin-top:-3em"><h2 class="sectionTitle">Schedule</h2><div id="seriesTimerSchedule"></div></section>';
    page.querySelector('form')!.addEventListener('submit', event => { event.preventDefault(); document.body.dataset.nativeSeriesSaved = page.querySelector('select')!.value; });
  });
  await expect(page.locator('body')).toHaveAttribute('data-tvl-recording-page', 'series-detail');
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await expect(page.locator('#itemDetailPage')).toHaveCSS('background-color', 'rgb(16, 17, 18)');
  await expect(page.locator('.btnCancelSeriesTimer')).toBeHidden();
  await page.getByRole('combobox', { name: 'Record' }).selectOption({ label: 'All episodes' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-native-series-saved', 'All episodes');
  await expect(page.locator('#seriesTimerScheduleSection')).toHaveCSS('margin-top', '24px');
});

test('recordings skin is TV-only and teardown removes its native listeners and scope', async ({ page }) => {
  await page.goto('/#/livetv?tab=4');
  await nativeSchedule(page);
  const timer = page.locator('[data-native-timer]');
  await timer.focus();
  await page.evaluate(() => { document.documentElement.classList.remove('layout-tv'); document.body.classList.remove('layout-tv'); });
  await expect(page.locator('body')).not.toHaveClass(/tvl-recordings-(native|ready)/);
  await expect(timer).toBeFocused();
  await page.evaluate(() => { document.documentElement.classList.add('layout-tv'); });
  await expect(page.locator('body')).toHaveClass(/tvl-recordings-native/);
  await page.evaluate(() => window.TvItemLayout!.destroy());
  await page.locator('[data-native-dvr-header]').getByRole('button', { name: 'Series', exact: true }).click();
  await expect(page.locator('body')).not.toHaveClass(/tvl-recordings-(native|ready)/);
  await expect(page.locator('body')).not.toHaveAttribute('data-tvl-recording-page');
});

test('recordings artwork and actions use Cinema spacing without changing playback identity', async ({ page }) => {
  await page.goto('/#/list?type=Recordings');
  const browse = page.getByRole('dialog', { name: 'Recordings', exact: true });
  await expect(browse.locator('[data-browse-item]')).toHaveCount(3);
  const art = browse.locator('[data-browse-item="recording-coast"]');
  await art.focus();
  await expect(art.locator('.tvl-browse-live')).toHaveText('Recording now');
  await expect(art.locator('.tvl-browse-caption')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(browse.locator('.tvl-browse-hero h1')).toHaveCSS('text-transform', 'uppercase');
  const margin = await browse.locator('.tvl-browse-controls').evaluate(node => parseFloat(getComputedStyle(node).paddingLeft));
  expect(margin).toBeCloseTo(1440 * .055, 0);
  await browse.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(page).toHaveURL(/#\/livetv\?tab=4/);
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await expect(page.locator('body')).toHaveAttribute('data-tvl-recording-page', 'schedule');
});
