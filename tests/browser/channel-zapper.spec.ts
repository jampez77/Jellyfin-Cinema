import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const channels = [
  { Id: 'channel-2', Type: 'TvChannel', Name: 'Zebra', ChannelNumber: '2' },
  { Id: 'channel-9', Type: 'TvChannel', Name: 'Alpha', ChannelNumber: '9' },
  { Id: 'channel-12', Type: 'TvChannel', Name: 'Horizon', ChannelNumber: '12' },
];
const records = [...channels,
  { Id: 'programme-9', Type: 'Program', Name: 'Coastal Roads', ChannelId: 'channel-9' },
  { Id: 'recorded-movie', Type: 'Movie', Name: 'A recorded movie', ChannelId: 'channel-9' },
  { Id: 'episode', Type: 'Episode', Name: 'An episode', ChannelId: 'channel-9' },
  { Id: 'song', Type: 'Audio', Name: 'A song' },
];

async function fixture(page: Page, extra = '') {
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    const script = `(() => {
      const api = window.TvItemLayoutDemo.api, getItem = api.getItem;
      const items = new Map(${JSON.stringify(records)}.map(item => [item.Id, item]));
      const state = window.__zap = { requests: 0, calls: [], plays: [], nativeKeys: [], nativeCommands: [], autoTransition: true, channels: ${JSON.stringify(channels)} };
      api.serverId = 'zap-server'; api.userId = 'zap-user';
      api.getItem = async id => items.get(id) || getItem(id);
      api.getPlaybackContext = async () => null;
      api.getChannels = async () => {
        state.requests++;
        if(state.holdChannels) await new Promise(resolve => {state.releaseChannels = resolve;});
        if(state.failChannels) throw new Error('Unavailable');
        return state.channels;
      };
      api.play = async (item,ticks,current) => {
        state.calls.push(item.Id);
        if(state.holdPlay) await new Promise(resolve => {state.releasePlay = resolve;});
        if (!current()) return;
        state.plays.push({id:item.Id,ticks});
        if (state.autoTransition) await window.__zapTransition(item.Id);
      };
      document.addEventListener('keydown', event => {if(!event.defaultPrevented)state.nativeKeys.push(event.key || event.keyCode);});
      document.addEventListener('command', event => {if(!event.defaultPrevented)state.nativeCommands.push(event.detail.command);});
      ${extra}
    })();`;
    await route.fulfill({ response, body: `${await response.text()}\n${script}` });
  });
}
async function player(page: Page, itemId = 'channel-9') {
  await page.goto('/?featured=0#/video');
  await page.evaluate(async itemId => {
    const container = document.createElement('div'); container.className = 'videoPlayerContainer';
    container.style.cssText = 'position:fixed;inset:0;background:#15241c';
    const video = document.createElement('video'); video.className = 'htmlvideoplayer'; video.muted = true;
    video.style.cssText = 'width:100%;height:100%';
    container.append(video); document.body.append(container);
    const osd = document.createElement('main'); osd.id = 'videoOsdPage'; osd.dataset.type = 'video-osd';
    osd.style.cssText = 'position:fixed;inset:0;z-index:1000';
    osd.innerHTML = '<div class="videoOsdBottom" style="position:fixed;bottom:0;left:0;right:0;padding:70px 24px 24px;display:flex"><div class="osdControls" style="flex:1"><button class="btnUserRating">Native control</button></div></div>';
    document.body.append(osd);
    (window as any).__zapTransition = async (id: string) => {
      (video.srcObject as MediaStream | null)?.getTracks().forEach(track => track.stop());
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext('2d')!; context.fillStyle = '#264d39'; context.fillRect(0, 0, 320, 180);
      video.srcObject = canvas.captureStream(5);
      osd.querySelector<HTMLElement>('.btnUserRating')!.dataset.id = id;
      await video.play(); osd.dispatchEvent(new CustomEvent('viewshow', { bubbles: true }));
    };
    await (window as any).__zapTransition(itemId);
    osd.querySelector<HTMLButtonElement>('button')!.focus();
  }, itemId);
  const label = itemId.startsWith('channel') || itemId === 'programme-9' ? 'Channels' : itemId === 'recorded-movie' ? 'More like this' : itemId === 'episode' ? 'Episodes & seasons' : 'Browse';
  await expect(page.locator('#tvl-player-browse')).toHaveAttribute('aria-label', label);
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
}
async function key(page: Page, keyName: string, options: { keyCode?: number; repeat?: boolean; release?: boolean; ctrlKey?: boolean } = {}) {
  return page.evaluate(({ keyName, options }) => {
    const target = document.activeElement!;
    const accepted = target.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, keyCode: options.keyCode, repeat: options.repeat, ctrlKey: options.ctrlKey }));
    if(options.release !== false)target.dispatchEvent(new KeyboardEvent('keyup', {key:keyName,keyCode:options.keyCode,bubbles:true}));
    return accepted;
  }, { keyName, options });
}
async function command(page: Page, name: string, repeat = false) {
  return page.evaluate(({ name, repeat }) => document.activeElement!.dispatchEvent(new CustomEvent('command', { bubbles: true, cancelable: true, detail: { command: name, repeat } })), { name, repeat });
}
const plays = (page: Page) => page.evaluate(() => (window as any).__zap.plays);
async function tuned(page: Page, id: string, count: number) {
  await expect.poll(() => plays(page)).toHaveLength(count);
  await expect(page.locator('.btnUserRating')).toHaveAttribute('data-id', id);
  await expect(page.locator('.tvl-channel-status')).toHaveCount(0);
}

for(const desktop of [false, true])test(`${desktop ? 'desktop' : 'TV'} Channel keys follow permitted guide order, wrap and preserve native playback`, async ({ page }) => {
  await fixture(page, desktop ? `document.body.classList.replace('layout-tv','layout-desktop');` : ''); await player(page);
  const video = await page.locator('video').elementHandle();
  expect(await key(page, 'ChannelUp')).toBe(false); await tuned(page, 'channel-12', 1);
  expect(await key(page, 'Unidentified', { keyCode: 427 })).toBe(false); await tuned(page, 'channel-2', 2);
  expect(await key(page, 'Unidentified', { keyCode: 428 })).toBe(false); await tuned(page, 'channel-12', 3);
  expect(await plays(page)).toEqual([{ id:'channel-12',ticks:0 },{ id:'channel-2',ticks:0 },{ id:'channel-12',ticks:0 }]);
  expect(await page.evaluate(() => (window as any).__zap.nativeKeys)).toEqual([]);
  await expect(page.locator('.btnUserRating')).toBeFocused();
  expect(await video!.evaluate(node => node === document.querySelector('video'))).toBe(true);
  await expect(page.locator('video')).toHaveJSProperty('paused',false);
  expect(await key(page,'PageUp',{keyCode:33})).toBe(true);
  expect(await key(page,'PageDown',{keyCode:34})).toBe(true);
  expect(await key(page,'ChannelUp',{ctrlKey:true})).toBe(true);
  expect(await command(page,'volumeup')).toBe(true);
});

test('Program identity uses ChannelId; native channel commands and held repeats dispatch once until playback starts',async({page})=>{
  await fixture(page, 'state.autoTransition=false;'); await player(page,'programme-9');
  expect(await command(page,'channelup')).toBe(false);
  await expect.poll(()=>plays(page)).toHaveLength(1);
  expect(await command(page,'channelup',true)).toBe(false);
  expect(await key(page,'ChannelDown',{release:false})).toBe(false);
  expect(await key(page,'ChannelDown',{repeat:true,release:false})).toBe(false);
  await expect.poll(()=>page.evaluate(()=>(window as any).__zap.requests)).toBe(1);
  await page.screenshot({path:test.info().outputPath('tuning-channel.png')});
  await page.evaluate(async()=>{(window as any).__zap.autoTransition=true;await (window as any).__zapTransition('channel-12');});
  await tuned(page,'channel-12',1);
  expect(await key(page,'ChannelDown',{repeat:true,release:false})).toBe(false);
  expect(await plays(page)).toHaveLength(1);
  await page.evaluate(()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keyup',{key:'ChannelDown',bubbles:true})));
  await key(page,'ChannelDown'); await tuned(page,'channel-9',2);
  expect(await page.evaluate(()=>(window as any).__zap.nativeCommands)).toEqual([]);
});

for(const item of ['recorded-movie','episode','song'])test(`${item} never changes channels even with incidental ChannelId`,async({page})=>{
  await fixture(page); await player(page,item);
  expect(await key(page,'ChannelUp')).toBe(true); expect(await command(page,'channeldown')).toBe(true);
  expect(await plays(page)).toEqual([]); expect(await page.evaluate(()=>(window as any).__zap.requests)).toBe(0);
});

test('text input, visible dialogs and mobile keep their native input ownership',async({page})=>{
  await fixture(page); await player(page);
  await page.evaluate(()=>{
    const input=document.createElement('input');input.id='native-input';document.querySelector('#videoOsdPage')!.append(input);input.focus();
  });
  expect(await key(page,'ChannelUp')).toBe(true); expect(await command(page,'channelup')).toBe(true);
  await page.locator('.btnUserRating').focus();
  await page.evaluate(()=>{const dialog=document.createElement('dialog');dialog.innerHTML='<button>Audio track</button>';document.body.append(dialog);dialog.showModal();});
  expect(await key(page,'ChannelDown')).toBe(true); expect(await command(page,'channeldown')).toBe(true);
  await page.evaluate(()=>{document.querySelector('dialog')!.remove();document.documentElement.classList.add('layout-mobile');});
  expect(await key(page,'ChannelUp')).toBe(true); expect(await command(page,'channelup')).toBe(true);
  expect(await plays(page)).toEqual([]); expect(await page.evaluate(()=>(window as any).__zap.requests)).toBe(0);
});

for(const change of ['account','server','route','media','destroy'])test(`a delayed lineup cannot tune after ${change} changes`,async({page})=>{
  await fixture(page,'state.holdChannels=true;'); await player(page);
  await key(page,'ChannelUp'); await expect.poll(()=>page.evaluate(()=>(window as any).__zap.requests)).toBe(1);
  await page.evaluate(async change=>{
    const api=(window as any).TvItemLayoutDemo.api;
    if(change==='account')api.userId='other-user';
    if(change==='server')api.serverId='other-server';
    if(change==='route')location.hash='/queue';
    if(change==='media')await (window as any).__zapTransition('recorded-movie');
    if(change==='destroy')(window as any).TvItemLayout.destroy();
  },change);
  if(change==='media')await expect(page.locator('#tvl-player-browse')).toHaveAttribute('aria-label','More like this');
  await page.evaluate(()=>{(window as any).__zap.holdChannels=false;(window as any).__zap.releaseChannels();});
  // A following native command runs after the released promise's microtasks.
  await command(page,'volumeup');
  expect(await plays(page)).toEqual([]); expect(await page.evaluate(()=>(window as any).__zap.calls)).toEqual([]);
  await expect(page.locator('.tvl-channel-status')).toHaveCount(0);
});

test('pending native dispatch stays serialized and its final guard rejects a changed account',async({page})=>{
  await fixture(page,'state.holdPlay=true;');await player(page);
  await key(page,'ChannelUp');await expect.poll(()=>page.evaluate(()=>(window as any).__zap.calls)).toEqual(['channel-12']);
  await key(page,'ChannelDown');await command(page,'channeldown');
  expect(await page.evaluate(()=>(window as any).__zap.calls)).toEqual(['channel-12']);
  await page.evaluate(()=>{(window as any).TvItemLayoutDemo.api.userId='other';(window as any).__zap.releasePlay();});
  await command(page,'volumeup');expect(await plays(page)).toEqual([]);
  await expect(page.locator('.tvl-channel-status')).toHaveCount(0);
});

test('unavailable and duplicate channels are skipped, with a safe retry after an API failure',async({page})=>{
  await fixture(page,`state.failChannels=true;state.channels.splice(2,0,{Id:'blocked',Type:'TvChannel',Name:'Not allowed',PlayAccess:'None'},state.channels[1],{Id:'virtual',Type:'TvChannel',Name:'Missing',IsMissing:true});`);
  await player(page);await key(page,'ChannelUp');
  await expect(page.locator('.tvl-channel-status')).toContainText('Unable to change channel');
  expect(await plays(page)).toEqual([]);
  await page.evaluate(()=>(window as any).__zap.failChannels=false);
  await key(page,'ChannelUp');await tuned(page,'channel-12',1);
  await page.evaluate(()=>(window as any).__zap.channels=[(window as any).__zap.channels[0]]);
  await key(page,'ChannelDown');await expect(page.locator('.tvl-channel-status')).toContainText('No other available channel');
  expect(await plays(page)).toHaveLength(1);
});

// Run the actual upstream inputManager command dispatch/fallback contract without
// vendoring GPL code. Native service callbacks are fixture-owned; media is a
// canvas stream, so this does not claim a real tuner/server integration test.
const nativeSource = process.env.TVL_JELLYFIN_WEB_SOURCE || '/tmp/tvl-jellyfin-web-12-audit';
const inputPath = resolve(nativeSource,'src/scripts/inputManager.js');
test('upstream inputManager cancellation prevents its native next/previous queue fallback',async({page})=>{
  test.skip(!existsSync(inputPath),'Set TVL_JELLYFIN_WEB_SOURCE to an audited Jellyfin web checkout.');
  const native = await build({stdin:{contents:`import input from ${JSON.stringify(inputPath)}; input.on(window,()=>{});window.__nativeInput=input;`,resolveDir:nativeSource},bundle:true,write:false,format:'iife',plugins:[{name:'native-fixtures',setup(build){
    build.onResolve({filter:/^(components\/|constants\/|utils\/)/},args=>({path:args.path,namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='utils/dom'?'export default {addEventListener:(s,n,f,o)=>s.addEventListener(n,f,o),removeEventListener:(s,n,f,o)=>s.removeEventListener(n,f,o)};'
      :args.path==='components/playback/playbackmanager'?'export const playbackManager={channelUp:()=>window.__zap.nativeFallbacks.push("up"),channelDown:()=>window.__zap.nativeFallbacks.push("down"),volumeUp:()=>window.__zap.nativeFallbacks.push("volume")};'
      :args.path==='components/apphost'?'export const appHost={supports:()=>false};'
      :args.path==='constants/appFeature'?'export const AppFeature={};'
      :args.path==='components/router/appRouter'?'export const appRouter={};':'export default {focusableParent:node=>node};',loader:'js'}));
  }}]});
  await fixture(page,'state.nativeFallbacks=[];');await player(page);
  await page.addScriptTag({content:native.outputFiles[0].text});
  await page.evaluate(()=>(window as any).__nativeInput.handleCommand('channelup'));await tuned(page,'channel-12',1);
  expect(await page.evaluate(()=>(window as any).__zap.nativeFallbacks)).toEqual([]);
  await page.evaluate(()=>(window as any).__nativeInput.handleCommand('volumeup'));
  expect(await page.evaluate(()=>(window as any).__zap.nativeFallbacks)).toEqual(['volume']);
});
