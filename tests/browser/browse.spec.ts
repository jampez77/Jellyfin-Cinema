import { expect, test, type Page } from '@playwright/test';
const musicRoute='/#/music?topParentId=library-music&collectionType=music';
const root=(page:Page,name:string)=>page.getByRole('dialog',{name,exact:true});
const music=(page:Page)=>root(page,'Music');
const recordings=(page:Page)=>root(page,'Recordings');
const cards=(page:Page,name:string)=>root(page,name).locator('[data-browse-item]');
async function patch(page:Page,source:string){await page.route('**/dist/demo.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:`${await response.text()}\n(()=>{const api=window.TvItemLayoutDemo.api;${source}})();`});});}

test('Home shows actual user libraries and progress rows, and library Back restores focus',async({page})=>{
  await page.goto('/#/home');
  const home=root(page,'Home');
  await expect(home.getByRole('navigation',{name:'Your libraries'}).locator('[data-library-id]')).toHaveCount(5);
  await expect(home.getByRole('region',{name:'Continue watching',exact:true}).locator('[data-browse-item]')).toHaveCount(2);
  await expect(home.getByRole('region',{name:'Next up',exact:true}).locator('[data-browse-item]')).toHaveCount(2);
  await expect(home.locator('.tvl-browse-hero h1')).toHaveText('After the Tide');
  const library=home.getByRole('navigation',{name:'Your libraries'}).getByRole('button',{name:'Movies',exact:true});
  await library.click();await expect(root(page,'Movies')).toBeVisible();
  await page.keyboard.press('Escape');await expect(library).toBeFocused();
});

test('Home retains native global search, favourites and settings access',async({page})=>{
  for(const [name,target] of [['Search Jellyfin',/#\/search(?:\?|$)/],['Favourites',/#\/home\?tab=1/],['Settings',/#\/mypreferencesmenu(?:\?|$)/]] as const){
    await page.goto('/#/home');await root(page,'Home').getByRole('navigation',{name:'Jellyfin navigation'}).getByRole('button',{name,exact:true}).click();
    await expect(page).toHaveURL(target);await expect(page.locator('#tv-layout')).toHaveCount(0);
  }
});

test('Music albums search, favourites and genre filters use real music data',async({page})=>{
  await page.goto(musicRoute);await expect(cards(page,'Music')).toHaveCount(4);
  await music(page).getByRole('searchbox',{name:'Search music'}).fill('Tidelight');
  await music(page).getByRole('searchbox',{name:'Search music'}).press('Enter');
  await expect(cards(page,'Music')).toHaveCount(1);await expect(cards(page,'Music')).toHaveAttribute('data-browse-item','album-tidelight');
  await music(page).getByRole('button',{name:'Clear search',exact:true}).click();
  await music(page).getByRole('button',{name:'Favourites',exact:true}).click();
  await expect(cards(page,'Music')).toHaveAttribute('data-browse-item','album-nightlines');
  await music(page).getByRole('button',{name:'Favourites',exact:true}).click();
  await music(page).getByRole('button',{name:'Genres',exact:true}).click();
  await music(page).getByRole('button',{name:'Jazz',exact:true}).click();
  await expect(cards(page,'Music')).toHaveAttribute('data-browse-item','album-nightlines');
  await expect(music(page).getByRole('heading',{name:'Jazz',exact:true})).toBeVisible();
  await expect(cards(page,'Music')).toBeFocused();
});

test('Artist and album details stay styled; album and individual track actions dispatch playable identities',async({page})=>{
  await patch(page,`api.play=async(item,ticks,current)=>{if(current())document.body.dataset.played=JSON.stringify({id:item.Id,type:item.Type,ticks});};`);
  await page.goto(`${musicRoute}&tab=3`);await expect(cards(page,'Music')).toHaveCount(3);
  await music(page).getByRole('button',{name:'Freya Moss',exact:true}).click();
  const artist=root(page,'Freya Moss details');await expect(artist.locator('[data-browse-item]')).toHaveCount(2);
  await artist.getByRole('button',{name:'Tidelight',exact:true}).click();
  const album=root(page,'Tidelight details');await expect(album.locator('[data-browse-item]')).toHaveCount(3);
  await album.getByRole('button',{name:'Play album',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-played',JSON.stringify({id:'album-tidelight',type:'MusicAlbum',ticks:0}));
  await album.getByRole('button',{name:'Play First Light',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-played',JSON.stringify({id:'song-tidelight-1',type:'Audio',ticks:0}));
  await expect(album.getByRole('status')).toHaveText('Playback requested. Open Now playing for controls.');
  await page.keyboard.press('Escape');await expect(artist.getByRole('button',{name:'Tidelight',exact:true})).toBeFocused();
});

test('Audio details recover from playback errors and support favourites without a video route',async({page})=>{
  await patch(page,`let first=true;api.play=async()=>{if(first){first=false;throw new Error('Audio output unavailable.');}};`);
  await page.goto('/#/details?id=song-tidelight-1');const song=root(page,'First Light details');
  await song.getByRole('button',{name:'Play',exact:true}).click();await expect(song.getByRole('status')).toHaveText('Audio output unavailable.');
  await song.getByRole('button',{name:'Play',exact:true}).click();await expect(song.getByRole('status')).toHaveText('Playback requested. Open Now playing for controls.');
  await expect(page).toHaveURL(/#\/details\?id=song-tidelight-1$/);
  await song.getByRole('button',{name:'Add to favourites',exact:true}).click();
  await expect(song.getByRole('button',{name:'Remove from favourites',exact:true})).toBeFocused();
});

test('Music suggestions, songs and native playlists preserve the correct tab contract',async({page})=>{
  await page.goto(`${musicRoute}&tab=1`);await expect(music(page).getByRole('region',{name:'Recently added',exact:true}).locator('[data-browse-item]')).toHaveCount(4);
  await expect(music(page).getByRole('region',{name:'Recently played',exact:true}).locator('[data-browse-item]')).toHaveCount(3);
  await music(page).getByRole('button',{name:'Songs',exact:true}).click();await expect(cards(page,'Music')).toHaveCount(12);
  await music(page).getByRole('button',{name:'Playlists',exact:true}).click();await expect(page).toHaveURL(/#\/music\?.*tab=4/);await expect(page.locator('#tv-layout')).toHaveCount(0);
});

test('Recordings support native list and live-TV tab routes, active/completed filters and title search',async({page})=>{
  await page.goto('/#/livetv?tab=3&collectionType=livetv');await expect(cards(page,'Recordings')).toHaveCount(3);
  await recordings(page).getByRole('button',{name:'Recording now',exact:true}).click();await expect(cards(page,'Recordings')).toHaveAttribute('data-browse-item','recording-coast');
  await recordings(page).getByRole('button',{name:'Completed',exact:true}).click();await expect(cards(page,'Recordings')).toHaveCount(2);
  await recordings(page).getByRole('searchbox',{name:'Search recordings'}).fill('clouds');await recordings(page).getByRole('searchbox',{name:'Search recordings'}).press('Enter');
  await expect(cards(page,'Recordings')).toHaveAttribute('data-browse-item','recording-mountain');
  await page.goto('/#/list?type=Recordings');await expect(cards(page,'Recordings')).toHaveCount(3);
});

test('Recordings display the native InProgress status in cards and highlighted metadata',async({page})=>{
  await patch(page,`const getRecordings=api.getRecordings;api.getRecordings=async(query)=>{const result=await getRecordings(query);return{...result,items:result.items.map(item=>item.Id==='recording-coast'?{...item,IsInProgress:undefined,Status:'InProgress'}:item)};};`);
  await page.goto('/#/list?type=Recordings');
  const card=recordings(page).locator('[data-browse-item="recording-coast"]');
  await expect(card.locator('.tvl-browse-live')).toHaveText('Recording now');
  await card.focus();await expect(recordings(page).locator('.tvl-browse-meta')).toContainText('Recording now');
});

test('Recording detail plays the actual recording and Back returns to its filtered browse state',async({page})=>{
  await patch(page,`api.play=async(item)=>{document.body.dataset.recordingPlayed=item.Id;};`);
  await page.goto('/#/list?type=Recordings');await recordings(page).getByRole('button',{name:'Completed',exact:true}).click();
  const card=recordings(page).getByRole('button',{name:'Wild Horizons: Above the Clouds',exact:true});await card.click();
  const detail=root(page,'Above the Clouds details');await expect(detail).toBeVisible();
  await detail.getByRole('button',{name:'Play',exact:true}).click();await expect(page.locator('body')).toHaveAttribute('data-recording-played','recording-mountain');
  await page.keyboard.press('Escape');await expect(card).toBeFocused();await expect(cards(page,'Recordings')).toHaveCount(2);
  await recordings(page).getByRole('button',{name:'Schedule',exact:true}).click();await expect(page).toHaveURL(/#\/livetv\?tab=4/);await expect(page.locator('#tv-layout')).toHaveCount(0);
});

test('Music pages retain raw pagination depth and focus after opening an album',async({page})=>{
  await patch(page,`const getItem=api.getItem;const album=i=>({Id:'large-album-'+i,Name:'Album '+i,Type:'MusicAlbum'});api.getItem=id=>id.startsWith('large-album-')?Promise.resolve(album(Number(id.slice(12)))):getItem(id);const starts=[];api.getMusic=async query=>{if(query.albumId)return{items:[],total:0,nextStartIndex:0};const start=query.startIndex||0;starts.push(start);document.body.dataset.musicStarts=JSON.stringify(starts);return{items:Array.from({length:start?2:47},(_,i)=>album(start+i)),total:50,nextStartIndex:start?50:48};};`);
  await page.goto(musicRoute);await expect(cards(page,'Music')).toHaveCount(47);await music(page).getByRole('button',{name:'Show more',exact:true}).click();await expect(cards(page,'Music')).toHaveCount(49);
  await music(page).getByRole('button',{name:'Album 49',exact:true}).click();await expect(root(page,'Album 49 details')).toBeVisible();await page.keyboard.press('Escape');
  await expect(music(page).getByRole('button',{name:'Album 49',exact:true})).toBeFocused();await expect(cards(page,'Music')).toHaveCount(49);await expect(page.locator('body')).toHaveAttribute('data-music-starts','[0,48,0,48]');
});

test('Browse failures retry and late responses cannot replace another route',async({page})=>{
  await patch(page,`const get=api.getRecordings;let first=true;api.getRecordings=async query=>{if(first){first=false;throw new Error('offline');}if(query.search==='slow'){document.body.dataset.waiting='true';await new Promise(resolve=>document.addEventListener('release-recordings',resolve,{once:true}));}return get(query);};`);
  await page.goto('/#/list?type=Recordings');await expect(recordings(page).getByRole('button',{name:'Try again',exact:true})).toBeFocused();await page.keyboard.press('Enter');await expect(cards(page,'Recordings')).toHaveCount(3);
  await recordings(page).getByRole('searchbox',{name:'Search recordings'}).fill('slow');await recordings(page).getByRole('searchbox',{name:'Search recordings'}).press('Enter');await expect(page.locator('body')).toHaveAttribute('data-waiting','true');
  await page.evaluate(()=>{location.hash='/home';});await expect(root(page,'Home')).toBeVisible();await page.evaluate(()=>document.dispatchEvent(new Event('release-recordings')));
  await expect(root(page,'Home').getByRole('navigation',{name:'Your libraries'}).locator('[data-library-id]')).toHaveCount(5);await expect(recordings(page)).toHaveCount(0);
});


test('Home exposes recordings only for a real Live TV view',async({page})=>{
  await page.goto('/#/home');await root(page,'Home').getByRole('navigation',{name:'Your libraries'}).getByRole('button',{name:'Recordings',exact:true}).click();
  await expect(recordings(page)).toBeVisible();
  await patch(page,`const get=api.getHome;api.getHome=async()=>{const result=await get();return{...result,libraries:result.libraries.filter(item=>item.CollectionType!=='livetv')};};`);
  await page.goto('/#/home');await expect(root(page,'Home').getByRole('navigation',{name:'Your libraries'}).getByRole('button',{name:'Recordings',exact:true})).toHaveCount(0);
});

test('Video dispatch stays pending, times out and rejects a late playback callback',async({page})=>{
  await page.clock.install();
  await patch(page,`let attempts=0;api.play=async(item,ticks,current)=>{document.body.dataset.playAttempts=String(++attempts);await new Promise(resolve=>document.addEventListener('finish-play',resolve,{once:true}));document.body.dataset.lateCurrent=String(current());};`);
  await page.goto('/#/details?id=recording-forest');const detail=root(page,'The Secret Life of Forests details');
  await detail.getByRole('button',{name:'Play',exact:true}).click();await expect(detail.getByRole('status')).toHaveText('Starting The Secret Life of Forests…');
  await detail.getByRole('button',{name:'Play',exact:true}).click();await expect(page.locator('body')).toHaveAttribute('data-play-attempts','1');
  await page.clock.runFor(15_100);await expect(detail.getByRole('status')).toHaveText('Playback has not started. Please try again.');
  await page.evaluate(()=>document.dispatchEvent(new Event('finish-play')));await expect(page.locator('body')).toHaveAttribute('data-late-current','false');
  await detail.getByRole('button',{name:'Play',exact:true}).click();await expect(page.locator('body')).toHaveAttribute('data-play-attempts','2');
});

test('Music exposes Jellyfin native Now playing queue without a video route',async({page})=>{
  await page.goto(musicRoute);await music(page).getByRole('button',{name:'Now playing',exact:true}).click();await expect(page).toHaveURL(/#\/queue(?:\?|$)/);await expect(page.locator('#tv-layout')).toHaveCount(0);
});
