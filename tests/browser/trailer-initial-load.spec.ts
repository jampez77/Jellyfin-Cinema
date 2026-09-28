import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

async function coldStart(page: Page, nativeIdentity: boolean, delayedItem = 'later-trailer') {
  await page.goto('/#/video');
  await page.evaluate(async nativeIdentity => {
    window.TvItemLayout?.destroy();
    document.documentElement.className = 'layout-tv';
    document.body.innerHTML = '<video class="htmlvideoplayer" muted style="position:fixed;inset:0;width:100%;height:100%"></video>'
      + '<div id="videoOsdPage" data-type="video-osd" style="position:fixed;inset:0">'
      + '<button class="btnUserRating">Favourite</button><button class="btnNextTrack">Next</button></div>';
    if (nativeIdentity) document.querySelector<HTMLElement>('.btnUserRating')!.dataset.id = 'first-trailer';
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    canvas.getContext('2d')!.fillRect(0, 0, 320, 180);
    const video = document.querySelector('video')!;
    video.srcObject = canvas.captureStream(5); video.muted = true; await video.play();
  }, nativeIdentity);
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { createPlayerContext } from ${JSON.stringify(resolve('src/player-context.ts'))};
    import { TrailerActions } from ${JSON.stringify(resolve('src/trailer-actions.ts'))};
    const items = {
      'first-trailer': { Id:'first-trailer', Type:'Trailer', Name:'Advertised film trailer' },
      'later-trailer': { Id:'later-trailer', Type:'Trailer', Name:'A later trailer' },
      'queued-film': { Id:'queued-film', Type:'Movie', Name:'The selected film' }
    };
    const queue = Object.keys(items).map((Id,index)=>({Id,PlaylistItemId:'queue-'+index}));
    window.__trailerReads = [];
    const api = {
      serverId:'test-server', userId:'test-user',
      getPlaybackContext:async()=>({PlayingItemId:'first-trailer',PlayingItemType:'Trailer',PlaylistItemId:'queue-0',Queue:queue}),
      getItem:async id=>{
        if(id === ${JSON.stringify(delayedItem)} && !window.__queueReady) await new Promise(resolve=>window.__resolveQueue=()=>{window.__queueReady=true;resolve();});
        return items[id];
      },
      getTrailerActions:async expected=>{
        window.__trailerReads.push(expected);
        return {PlayingItemId:'first-trailer',PlaylistItemId:'queue-0',Movie:{Id:'advertised-film',Name:'Advertised film'},InWatchlist:false};
      }
    };
    window.__initialApi = api;
    const context = createPlayerContext(()=>api);
    window.__initialContext = context;
    window.__initialActions = new TrailerActions(context,()=>api);
  ` }, bundle:true,write:false,format:'iife',target:'chrome79' });
  await page.addScriptTag({ content:bundle.outputFiles[0].text });
}

for (const delayedItem of ['first-trailer', 'later-trailer']) for (const nativeIdentity of [true, false]) test(`first trailer shows actions before ${delayedItem} metadata loads (${nativeIdentity ? 'native identity' : 'session identity'})`, async ({ page }) => {
  await coldStart(page, nativeIdentity, delayedItem);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__resolveQueue)).toBe('function');
  await expect(page.getByRole('button', { name:'Skip trailer', exact:true })).toBeVisible({timeout:1500});
  await expect(page.locator('#tvl-trailer-actions')).toHaveAttribute('data-movie-id','advertised-film');
  expect(await page.evaluate(() => (window as any).__initialContext.getSnapshot().playingItemId)).toBe('first-trailer');
  await page.evaluate(() => (window as any).__resolveQueue());
  await expect.poll(() => page.evaluate(() => (window as any).__initialContext.getSnapshot().upcomingItemId)).toBe('queued-film');
  await expect(page.getByRole('button', { name:'Skip trailer', exact:true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__trailerReads.every((identity:any)=>identity.PlayingItemId === 'first-trailer'))).toBe(true);
});

test('leaving during a cold queue lookup cannot restore first-trailer actions', async ({ page }) => {
  await coldStart(page, false);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__resolveQueue)).toBe('function');
  await expect(page.getByRole('button', { name:'Skip trailer', exact:true })).toBeVisible({timeout:1500});
  await page.evaluate(() => {
    document.querySelector('#videoOsdPage')!.dispatchEvent(new CustomEvent('viewbeforehide',{bubbles:true}));
    (window as any).__resolveQueue();
  });
  await expect(page.locator('#tvl-trailer-actions')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__initialContext.getSnapshot())).toBeNull();
});
