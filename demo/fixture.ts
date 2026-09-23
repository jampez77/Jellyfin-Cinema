import type { Item, LibraryQuery, MediaApi } from '../src/types';
import { el, picture, replace } from '../src/dom';

// This file belongs to the preview only. It is never included in the installer bundle.
const MINUTE = 60 * 10_000_000;
const scenario = new URLSearchParams(location.search).get('scenario');
const library = new Map<string, Item>();
const artwork = new Map<string, string>();
const asset = (name: string) => `/demo/assets/${name}.jpg`;
const seasons: Item[] = [];
const episodes = new Map<string, Item[]>();
const channels: Item[] = [];
const schedules = new Map<string, Item[]>();
const favorites = new Set<string>(['movie-blue', 'series-harbour']);

function register(item: Item, photo: string): Item {
  library.set(item.Id, item);
  artwork.set(item.Id, asset(photo));
  return item;
}

const cast = [
  { Name: 'Mara Ellison', Type: 'Actor', Role: 'Elin Ward' },
  { Name: 'Jonas Reed', Type: 'Actor', Role: 'Tom Vale' },
  { Name: 'Sofia Arden', Type: 'Actor', Role: 'June Mercer' },
  { Name: 'Theo Linden', Type: 'Actor', Role: 'Daniel Ward' },
];
const streams = [
  { Type: 'Video', Width: 3840, DisplayTitle: '4K HEVC' },
  { Type: 'Audio', DisplayTitle: 'English · Dolby Digital 5.1', Language: 'eng' },
  { Type: 'Subtitle', DisplayTitle: 'English CC', Language: 'eng' },
];

register({
  Id: 'series-north', Type: 'Series', Name: 'North of Nowhere', ProductionYear: 2024,
  OfficialRating: 'TV-14', CommunityRating: 8.6, Genres: ['Drama', 'Mystery', 'Adventure'],
  Tags: ['Atmospheric', 'Slow burn'], Taglines: ['Some places never let you go.'],
  Overview: 'When a missing hiker returns after twenty years, a quiet mountain town begins to unravel. For ranger Elin Ward, finding the truth means facing the one place she swore she would never go back to.',
  People: [...cast, { Name: 'Ada Voss', Type: 'Director' }], ChildCount: 3, RecursiveItemCount: 18,
  MediaStreams: streams, ImageTags: { Primary: 'demo' }, BackdropImageTags: ['demo'],
}, 'mountains');

const seasonStories = [
  [
    ['The Long Way Home', 'Elin returns to the valley for a routine search. A discovery on the old north trail turns a rescue into something far more personal.', 49],
    ['A Line in the Snow', 'A storm closes the mountain pass. While the town waits for answers, Elin follows a trail that should have disappeared years ago.', 47],
    ['The Other Side', 'An unexpected visitor knows more about the missing hiker than they admit. June uncovers a photograph with a familiar face.', 52],
    ['Still Water', 'A search at the abandoned reservoir brings old loyalties into question. Tom must decide how much of the past to share.', 46],
    ['What We Leave Behind', 'As the first thaw opens a forgotten route, Elin learns why her father never spoke about his final winter on the mountain.', 51],
    ['North of Nowhere', 'With the town divided and another storm approaching, Elin takes the north trail one last time. The truth is closer than she thinks.', 57],
  ],
  [
    ['First Light', 'Six months after the search, a letter from across the border draws Elin back into the valley’s unfinished story.', 48],
    ['The Crossing', 'A journey to the coast reveals an unlikely connection. Back home, June finds that someone has been listening.', 50],
    ['Undertow', 'An old friend offers shelter and a warning. Tom follows a lead that puts him at odds with the rest of the team.', 46],
    ['The Quiet Hours', 'One night at the isolated station changes everything. Elin must trust a stranger to keep her promise.', 51],
    ['A Place to Stay', 'As the valley prepares for winter, a familiar voice brings news from the north. June chooses her own way forward.', 49],
    ['All That Remains', 'Elin and Tom piece together the final hours before the disappearance, but there is one account they have not heard.', 56],
  ],
  [
    ['Open Country', 'A year of calm ends with a call from the highlands. Elin returns to the work she knows, carrying a secret she cannot leave behind.', 50],
    ['Weather Coming', 'New evidence sends the team beyond the marked paths. At the station, June makes a discovery of her own.', 48],
    ['The Distance Between', 'A difficult reunion gives Tom a chance to make amends. Elin begins to question what it means to come home.', 53],
    ['Into the Blue', 'With the search widening, an unexpected ally leads the team toward the coast and a house that has stood empty for years.', 47],
    ['The Last Winter', 'The valley gathers as the first snow arrives. Before the pass closes, Elin has one final promise to keep.', 54],
    ['Here, at Last', 'On the longest night of the year, the people of the valley find their way back to one another.', 61],
  ],
] as const;

seasonStories.forEach((stories, seasonIndex) => {
  const number = seasonIndex + 1;
  const season = register({
    Id: `season-north-${number}`, Type: 'Season', Name: `Season ${number}`, IndexNumber: number,
    SeriesId: 'series-north', SeriesName: 'North of Nowhere', ChildCount: stories.length,
    ProductionYear: 2023 + number,
  }, 'mountains');
  seasons.push(season);
  episodes.set(season.Id, stories.map(([name, overview, minutes], index) => register({
    Id: `episode-north-${number}-${index + 1}`, Type: 'Episode', Name: name, Overview: overview,
    SeriesId: 'series-north', SeriesName: 'North of Nowhere', SeasonId: season.Id,
    IndexNumber: index + 1, ParentIndexNumber: number, RunTimeTicks: minutes * MINUTE,
    OfficialRating: 'TV-14', ProductionYear: 2023 + number, Genres: ['Drama', 'Mystery'],
    People: cast, MediaStreams: streams, ImageTags: { Primary: 'demo' },
    UserData: seasonIndex === 0 && index === 0 ? { Played: true, PlayedPercentage: 100 }
      : seasonIndex === 0 && index === 1 ? { PlaybackPositionTicks: 18.5 * MINUTE, PlayedPercentage: 39.4 } : {},
  }, number === 1 ? ['mountains', 'forest', 'mountains', 'ocean', 'forest', 'mountains'][index]!
    : ['forest', 'ocean', 'mountains', 'forest', 'mountains', 'ocean'][index]!)));
});

const seriesIds = ['series-north'];
const moreShows = [
  { id:'series-harbour', name:'The Last Harbour', year:2025, photo:'ocean', genres:['Drama', 'Mystery'],
    overview:'A harbourmaster returns to her island home to find a ship nobody remembers arriving. Each tide reveals another part of the town’s unfinished story.',
    episodes:['A Ship in the Night', 'Low Tide', 'The Lantern Room'] },
  { id:'series-signal', name:'Signal 24', year:2024, photo:'mountains', genres:['Mystery', 'Sci-Fi'],
    overview:'An isolated radio station begins receiving messages from tomorrow. Its small crew must decide which warnings to trust and which futures to change.',
    episodes:['The First Transmission', 'Dead Air', 'Tomorrow’s Voice'] },
  { id:'series-1999', name:'1999', year:2023, photo:'forest', genres:['Drama', 'History'],
    overview:'Four friends reunite in the town where they grew up, on the eve of a new millennium. A summer they thought forgotten connects the lives they lead today.',
    episodes:['The Reunion', 'Summer on Tape', 'Midnight'] },
  { id:'series-wild', name:'Wild Country', year:2025, photo:'forest', genres:['Documentary', 'Adventure'],
    overview:'Follow the changing seasons across mountains, forests and remote coastlines, through the lives of the animals and people who call them home.',
    episodes:['Mountain Spring', 'Under the Canopy', 'The Living Coast'] },
];
for (const spec of moreShows) {
  seriesIds.push(spec.id);
  register({ Id:spec.id, Type:'Series', Name:spec.name, Overview:spec.overview, ProductionYear:spec.year,
    OfficialRating:'TV-14', Genres:spec.genres, ChildCount:1, RecursiveItemCount:spec.episodes.length,
    ImageTags:{Primary:'demo'}, BackdropImageTags:['demo'] }, spec.photo);
  const season = register({ Id:`season-${spec.id.slice(7)}-1`, Type:'Season', Name:'Season 1',
    SeriesId:spec.id, SeriesName:spec.name, IndexNumber:1, ChildCount:spec.episodes.length }, spec.photo);
  seasons.push(season);
  episodes.set(season.Id, spec.episodes.map((name, index) => register({
    Id:`episode-${spec.id.slice(7)}-1-${index+1}`, Type:'Episode', Name:name, Overview:spec.overview,
    SeriesId:spec.id, SeriesName:spec.name, SeasonId:season.Id, ParentIndexNumber:1, IndexNumber:index+1,
    RunTimeTicks:(44+index*3)*MINUTE, ProductionYear:spec.year, OfficialRating:'TV-14', Genres:spec.genres,
    ImageTags:{Primary:'demo'}, UserData:spec.id==='series-harbour' && index===0
      ? {PlaybackPositionTicks:12*MINUTE, PlayedPercentage:27.3} : {},
  }, spec.photo)));
}

const movieCast = [
  { Name: 'Romy Bell', Type: 'Actor', Role: 'Wren' },
  { Name: 'Elias North', Type: 'Actor', Role: 'Miles' },
  { Name: 'Leah Vale', Type: 'Actor', Role: 'Nora' },
  { Name: 'Noah Arlen', Type: 'Director' },
  { Name: 'Freya Moss', Type: 'Writer' },
];
const movieIds: string[] = [];
function movie(id: string, name: string, overview: string, year: number, minutes: number, photo: string, genres: string[]) {
  movieIds.push(id);
  return register({
    Id: id, Type: 'Movie', Name: name, Overview: overview, ProductionYear: year,
    RunTimeTicks: minutes * MINUTE, OfficialRating: 'PG-13', CommunityRating: id === 'movie-tide' ? 8.1 : 7.7,
    Genres: genres, Taglines: ['Everything finds its way home.'], People: movieCast,
    MediaStreams: streams, ImageTags: { Primary: 'demo' }, BackdropImageTags: ['demo'],
    UserData: id === 'movie-tide' ? { PlaybackPositionTicks: 28.25 * MINUTE, PlayedPercentage: 24.8 } : {},
  }, photo);
}
movie('movie-tide', 'After the Tide', 'Returning to the island she left behind, a young photographer discovers a box of letters that changes everything she remembers about her family. Across one unforgettable summer, she learns that finding your way forward sometimes means going back.', 2025, 114, 'ocean', ['Drama', 'Adventure']);
movie('movie-silence', 'The Shape of Silence', 'An architect inherits a remote woodland cabin and the unfinished recordings of a life she never knew. A quiet story about the things we keep, and the things we finally let go.', 2024, 106, 'forest', ['Drama', 'Mystery']);
movie('movie-higher', 'Higher Ground', 'Two estranged brothers reunite for the mountain expedition their father never completed. On the journey to the summit, the distance between them proves the hardest climb.', 2023, 122, 'mountains', ['Adventure', 'Drama']);
movie('movie-wild', 'Where the Wild Things Wait', 'A naturalist and a restless teenager spend a summer tracking a rare bird through an ancient forest. An unlikely friendship takes root far from the world they know.', 2025, 98, 'forest', ['Adventure', 'Drama']);
movie('movie-blue', 'A Kind of Blue', 'On the last ferry of the season, a musician meets a stranger who is travelling with no destination. As the coastline slips away, their stories begin to change.', 2024, 109, 'ocean', ['Drama', 'Romance']);

const collectionMembers = new Map<string, string[]>([
  ['collection-coast', ['movie-tide', 'movie-blue']],
  ['collection-wilderness', ['series-north', 'movie-higher', 'movie-wild']],
]);
register({ Id:'library-collections', Type:'CollectionFolder', CollectionType:'boxsets', Name:'Collections' }, 'mountains');
register({ Id:'library-movies', Type:'CollectionFolder', CollectionType:'movies', Name:'Movies' }, 'ocean');
register({ Id:'library-tv', Type:'CollectionFolder', CollectionType:'tvshows', Name:'TV Shows' }, 'mountains');
register({ Id:'collection-coast', Type:'BoxSet', Name:'Coastal Stories', Overview:'Journeys shaped by the sea. Discover stories of homecoming, chance encounters and life along the coast.', ChildCount:2 }, 'ocean');
register({ Id:'collection-wilderness', Type:'BoxSet', Name:'Into the Wilderness', Overview:'Step beyond the familiar. Mountain mysteries and open-country adventures from your library.', ChildCount:3 }, 'mountains');

const movieGenres = [...new Set(movieIds.flatMap(id=>library.get(id)!.Genres || []))].sort().map(name=>({Id:`genre-${name.toLowerCase()}`,Name:name,Type:'Genre'}));
const showGenres = [...new Set(seriesIds.flatMap(id=>library.get(id)!.Genres || []))].sort().map(name=>({Id:`genre-${name.toLowerCase()}`,Name:name,Type:'Genre'}));
const movieSortName = (item:Item) => item.Name.replace(/^(the|an|a)\s+/i,'').toLocaleLowerCase();

// Anchor each schedule to the current half hour, so the fixture always has a live show.
const now = Date.now();
const scheduleStart = Math.floor(now / (30 * 60_000)) * 30 * 60_000 - 15 * 60_000;
const channelSpecs = [
  { id: 'channel-field', name: 'Field Notes', number: '101', photo: 'forest', genre: 'Nature', programs: [
    ['The Secret Life of Forests', 'Journey beneath the canopy of Europe’s oldest woodlands, where every tree is connected and the smallest creatures shape an extraordinary world.'],
    ['Wild Water', 'From mountain streams to open ocean, follow the hidden journeys that connect life on our planet.', 'ocean'],
    ['Above the Clouds', 'A new perspective on the animals and people who make their homes in the world’s highest places.', 'mountains'],
    ['Earth After Dark', 'As daylight fades, a remarkable cast of nocturnal creatures begins its day.'],
  ] },
  { id: 'channel-horizon', name: 'Horizon', number: '102', photo: 'mountains', genre: 'Travel', programs: [
    ['The Long Way North', 'A slow journey through the northern wilderness, meeting the people who call this remarkable landscape home.'],
    ['Coastal Roads', 'Along a remote coastline, old traditions meet a new generation of travellers.', 'ocean'],
    ['The Mountain Kitchen', 'Discover the ingredients and family recipes that connect isolated mountain communities.'],
    ['A World Away', 'Small stories from places far beyond the familiar.'],
  ] },
  { id: 'channel-drift', name: 'Drift', number: '103', photo: 'ocean', genre: 'Documentary', programs: [
    ['Oceans Between Us', 'Scientists and sailors share their encounters with the living world beneath the surface.'],
    ['Islands of Tomorrow', 'Meet the communities imagining a different future for their island homes.'],
    ['Under Open Skies', 'An unhurried exploration of the world’s most extraordinary coastlines.'],
    ['At the Water’s Edge', 'A portrait of the people whose lives follow the rhythm of the tide.'],
  ] },
  { id: 'channel-outside', name: 'Outside', number: '104', photo: 'mountains', genre: 'Adventure', programs: [
    ['Beyond the Trail', 'Three friends leave the mapped trails behind for a week in the high country.'],
    ['First Ascent', 'A new generation of climbers prepares for its biggest challenge.'],
    ['The Open Road', 'Follow a photographer finding unexpected stories at every stop.', 'forest'],
    ['One More Mile', 'The people and places that make a long journey worth taking.'],
  ] },
];
channelSpecs.forEach((spec, channelIndex) => {
  // Varied durations make the common timeline easy to compare across channels.
  const durations = [[60,30,90,60],[90,30,60,60],[60,90,30,60],[75,45,90,30]][channelIndex]!;
  const programs = spec.programs.map(([name, overview, photo], index) => register({
    Id: `${spec.id}-program-${index + 1}`, Type: 'Program', Name: name!, Overview: overview!,
    ChannelId: spec.id, ChannelName: spec.name,
    StartDate: new Date(scheduleStart + durations.slice(0,index).reduce((sum,minutes)=>sum+minutes,0) * 60_000).toISOString(),
    EndDate: new Date(scheduleStart + durations.slice(0,index+1).reduce((sum,minutes)=>sum+minutes,0) * 60_000).toISOString(), RunTimeTicks: durations[index]! * MINUTE,
    OfficialRating: 'TV-G', Genres: [spec.genre], ProductionYear: 2025,
    MediaStreams: [{ Type: 'Video', Width: 1920, DisplayTitle: '1080p' }, { Type: 'Audio', DisplayTitle: 'English · Stereo', Language: 'eng' }],
  }, photo || spec.photo));
  schedules.set(spec.id, programs);
  channels.push(register({
    Id: spec.id, Type: 'TvChannel', Name: spec.name, ChannelNumber: spec.number, Number: spec.number,
    CurrentProgram: programs[0], Genres: [spec.genre],
    Overview: spec.id === 'channel-field' ? 'Extraordinary stories from the natural world. Get closer to the wild, every day.' : `A fresh perspective on ${spec.genre.toLowerCase()}, all day.`,
    ImageTags: { Primary: 'demo' }, BackdropImageTags: ['demo'],
  }, spec.photo));
});

function copy(item: Item): Item {
  return { ...item, UserData: { ...item.UserData, IsFavorite: favorites.has(item.Id) } };
}
async function respond<T>(value: () => T, id?: string): Promise<T> {
  // Alternating durations make rapid switches in the slow scenario finish out of order.
  const delay = scenario === 'slow' ? (id?.includes('-2') ? 1700 : 800) : 90;
  await new Promise((resolve) => setTimeout(resolve, delay));
  if (scenario === 'error') throw new Error('The demo server could not be reached. Remove ?scenario=error to restore the preview.');
  return value();
}
function list(items: Item[]): Item[] { return scenario === 'empty' ? [] : items.map(copy); }

let lastDetailHash = '#/details?id=series-north';
let player: HTMLElement | null = null;
function closePlayer() {
  player?.remove();
  player = null;
  document.body.classList.remove('demo-is-playing');
}
function returnToDetails() { location.hash = lastDetailHash; }
function showPlayer(item: Item, ticks: number) {
  closePlayer();
  if (/^#\/(details|livetv)(\?|$)/.test(location.hash)) lastDetailHash = location.hash;
  player = document.createElement('main');
  player.className = 'demo-player';
  player.setAttribute('aria-label', 'Demo playback');
  const art = document.createElement('div');
  art.className = 'demo-player-art';
  art.style.backgroundImage = `url("${artwork.get(item.Id) || artwork.get(item.ChannelId || '') || asset('mountains')}")`;
  const content = document.createElement('div');
  content.className = 'demo-player-content';
  content.setAttribute('role','dialog');
  content.setAttribute('aria-modal','true');
  content.setAttribute('aria-label','Playback controls');
  content.innerHTML = '<div class="demo-player-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3v18l15-9z"/></svg></div><p class="demo-player-eyebrow">Demo playback</p><h1></h1><p class="demo-player-info"></p><button type="button">Back to details</button><span class="demo-player-key">Press Escape to return</span>';
  content.querySelector('h1')!.textContent = item.Type === 'Episode' ? `${item.SeriesName} · ${item.Name}` : item.Name;
  const resumeTime = `${Math.floor(ticks / MINUTE)}:${String(Math.floor(ticks / 10_000_000) % 60).padStart(2, '0')}`;
  const playbackNote = item.Type === 'Trailer' ? ' Trailer playback would start from the beginning.'
    : item.Type === 'TvChannel' || item.Type === 'Program' ? ' The live channel would begin playing.'
    : ticks > 0 ? ` Playback would resume at ${resumeTime}.` : ' Playback would start from the beginning.';
  content.querySelector('.demo-player-info')!.textContent = `This is a simulated player. No actual stream is playing.${playbackNote}`;
  const back = content.querySelector('button')!;
  if(lastDetailHash.startsWith('#/livetv'))back.textContent='Back to guide';
  back.addEventListener('click', returnToDetails);
  player.append(art, content);
  document.body.append(player);
  document.body.classList.add('demo-is-playing');
  location.hash = '#/video';
  requestAnimationFrame(() => back.focus());
}

function browseLibrary(ids: string[], genres: Item[], parentId: string, query: LibraryQuery) {
  if (query.parentId && query.parentId !== parentId) return {items:[],total:0,nextStartIndex:query.startIndex||0};
  const genre=genres.find(item=>item.Id===query.genreId)?.Name;
  const items=list(ids.map(id=>library.get(id)!)).filter(item=>
    (!query.search || item.Name.toLocaleLowerCase().includes(query.search.trim().toLocaleLowerCase()))
    && (!query.favorite || favorites.has(item.Id))
    && (!query.genreId || !!genre&&item.Genres?.includes(genre))
    && (!query.letter || (query.letter==='#'?movieSortName(item).charAt(0)<'a':movieSortName(item).startsWith(query.letter.toLocaleLowerCase())))
  ).sort((a,b)=>movieSortName(a).localeCompare(movieSortName(b)));
  const start=query.startIndex||0;const page=items.slice(start,start+(query.limit||60));
  return {items:page,total:items.length,nextStartIndex:start+page.length};
}

const api: MediaApi = {
  getItem: (id) => respond(() => {
    const item = library.get(id);
    if (!item) throw new Error('This item is not available in the local preview.');
    const result = copy(item);
    if (scenario === 'empty' && result.Type === 'TvChannel') delete result.CurrentProgram;
    return result;
  }, id),
  getSeasons: (seriesId) => respond(() => list(seasons.filter(season=>season.SeriesId===seriesId)), seriesId),
  getEpisodes: (_seriesId, seasonId) => respond(() => list(episodes.get(seasonId) || []), seasonId),
  getNextEpisode: (seriesId) => respond(() => {
    if (scenario==='empty') return null;
    const item = seriesId==='series-north' ? library.get('episode-north-1-2')
      : episodes.get(seasons.find(season=>season.SeriesId===seriesId)?.Id||'')?.[0];
    return item ? copy(item) : null;
  }, seriesId),
  getSimilar: (id) => respond(() => list(movieIds.filter((movieId) => movieId !== id).map((movieId) => library.get(movieId)!)), id),
  getCollections: (id) => respond(() => list([...collectionMembers].filter(([,members]) => members.includes(id)).map(([collectionId]) => library.get(collectionId)!)), id),
  getCollectionList: (parentId) => respond(() => list([...collectionMembers].filter(([,members])=>parentId!=='library-tv'||members.some(id=>seriesIds.includes(id))).map(([id])=>library.get(id)!))),
  getCollectionItems: (id) => respond(() => list((collectionMembers.get(id) || []).map(member=>library.get(member)!)),id),
  getMovies: (query) => respond(() => browseLibrary(movieIds, movieGenres, 'library-movies', query), query.search),
  getShows: (query) => respond(() => browseLibrary(seriesIds, showGenres, 'library-tv', query), query.search),
  getShowGenres: (parentId) => respond(() => list(!parentId || parentId==='library-tv' ? showGenres : [])),
  getShowSuggestions: (parentId) => respond(() => scenario==='empty' || parentId && parentId!=='library-tv' ? [] : [
    {title:'Continue watching',items:['episode-north-1-2','episode-harbour-1-1'].map(id=>copy(library.get(id)!))},
    {title:'Next up',items:['episode-signal-1-1','episode-wild-1-1'].map(id=>copy(library.get(id)!))},
    {title:'Recently added',items:['series-1999','series-wild','episode-north-3-6'].map(id=>copy(library.get(id)!))},
  ]),
  getMovieGenres: () => respond(()=>list(movieGenres)),
  getMovieSuggestions: () => respond(()=>scenario==='empty'?[]:[
    {title:'Continue watching',items:[copy(library.get('movie-tide')!)]},
    {title:'Recently added',items:movieIds.slice().reverse().map(id=>copy(library.get(id)!))},
    {title:'Because you like A Kind of Blue',items:['movie-tide','movie-silence'].map(id=>copy(library.get(id)!))}
  ]),
  getChannels: () => respond(() => list(channels)),
  getPrograms: (channelId) => respond(() => list(schedules.get(channelId) || []), channelId),
  setFavorite: (id, favorite) => respond(() => { if (favorite) favorites.add(id); else favorites.delete(id); }, id),
  play: async (item, ticks, isCurrent) => { await respond(() => undefined, item.Id); if (isCurrent()) showPlayer(item, ticks); },
  playTrailer: async (item, isCurrent) => {
    await respond(() => undefined, item.Id);
    if (!isCurrent()) return;
    if (item.Type !== 'Movie' || scenario === 'empty') throw new Error('No trailer is available for this film.');
    showPlayer({ ...item, Type:'Trailer', Name:`${item.Name} · Official trailer`, UserData:{} },0);
  },
  image: (item, kind) => kind === 'logo' ? null : artwork.get(item.Id) || artwork.get(item.SeriesId || '') || artwork.get(item.ChannelId || '') || null,
};

const nativePage = document.querySelector<HTMLElement>('.demo-native-page')!;
const originalNativeContent = nativePage.innerHTML;
function syncRoute() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const current = library.get(params.get('id') || 'series-north');
  const guide = location.hash.startsWith('#/livetv');
  const movies = location.hash.startsWith('#/movies');
  const shows = /^#\/tv(?:\?|$)/.test(location.hash);
  nativePage.id=movies?'moviesPage':shows?'tvRecommendedPage':'';
  const collection = location.hash.startsWith('#/details') && current?.Type === 'BoxSet';
  const collectionList = /^#\/(list|boxsets)\?/.test(location.hash) && (params.get('parentId')==='library-collections'||location.hash.startsWith('#/boxsets')||params.get('type')==='BoxSet');
  nativePage.classList.toggle('mainAnimatedPage',collectionList);
  nativePage.classList.toggle('libraryPage',collectionList);
  nativePage.classList.toggle('demo-collection-page',collection);
  if (collection) {
    const content = el('div','demo-collection-content');
    const back = el('button','','← Back');back.type='button';back.addEventListener('click',()=>history.back());
    content.append(back,el('p','demo-native-eyebrow','COLLECTION'),el('h1','',current.Name));
    const grid = el('div','demo-collection-grid');
    for (const id of collectionMembers.get(current.Id) || []) {
      const member = library.get(id)!;
      const link = el('a');link.href=`#/details?id=${encodeURIComponent(id)}`;
      link.append(picture(artwork.get(id) || null,'demo-collection-art'),el('h2','',member.Name));
      grid.append(link);
    }
    content.append(grid);replace(nativePage,content);
  } else if (collectionList) {
    const content=el('div','demo-collection-content');content.append(el('h1','','Collections'));
    const items=el('div','itemsContainer');items.dataset.parentid=params.get('parentId')||'';content.append(items);replace(nativePage,content);
  } else if (nativePage.querySelector('.demo-collection-content')) nativePage.innerHTML=originalNativeContent;
  const type = collection||collectionList?'collections':movies?'movie':guide ? 'live' : current?.Type === 'Movie' ? 'movie' : current?.Type === 'TvChannel' || current?.Type === 'Program' ? 'live' : 'series';
  document.querySelectorAll<HTMLAnchorElement>('[data-demo-type]').forEach((link) => {
    if (link.dataset.demoType === type && (guide || movies || shows || collectionList || location.hash.startsWith('#/details'))) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (!location.hash.startsWith('#/video')) closePlayer();
}

window.addEventListener('hashchange', syncRoute);
window.addEventListener('keydown', (event) => {
  if (player && ['Escape', 'BrowserBack', 'GoBack', 'MediaStop'].includes(event.key)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    returnToDetails();
  }
}, true);
if (!location.hash) history.replaceState(null, '', `${location.pathname}${location.search}#/details?id=series-north`);
window.TvItemLayoutDemo = { api, initialItem: 'series-north' };
syncRoute();
