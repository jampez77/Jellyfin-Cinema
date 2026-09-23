import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowseApi, type BrowseClient } from '../src/browse-api';
import type { Item } from '../src/types';

type Request={path:string;query:Record<string,string|number|boolean>};
const item=(Id:string,Type='MusicAlbum',extra:Partial<Item>={}):Item=>({Id,Name:Id,Type,...extra});
function setup(handler:(request:Request)=>unknown,overrides:Partial<BrowseClient>={}) {
  const requests:Request[]=[];
  const client:BrowseClient={
    getUrl:(path,query={})=>JSON.stringify({path,query}),
    getJSON:async url=>{const request=JSON.parse(url) as Request;requests.push(request);return handler(request);},
    getItems:async(user,query)=>{assert.equal(user,'user');const request={path:'Items',query};requests.push(request);return handler(request) as never;},
    getNextUpEpisodes:async query=>{const request={path:'Shows/NextUp',query};requests.push(request);return handler(request) as never;},
    ...overrides
  };
  return {api:createBrowseApi(client,'user',action=>action()),client,requests};
}

test('Home uses user-visible libraries, native resume/next-up and library-scoped latest items',async()=>{
  const {api,requests}=setup(({path,query})=>{
    if(path==='Users/user/Views')return{Items:[item('movies','CollectionFolder',{CollectionType:'movies',Name:'Movies'}),item('music','CollectionFolder',{CollectionType:'music',Name:'Music'}),item('collections','CollectionFolder',{CollectionType:'boxsets'})]};
    if(path.endsWith('/Resume'))return{Items:[item('resume','Movie'),item('missing','Movie',{IsMissing:true})]};
    if(path==='Shows/NextUp')return{Items:[item('next','Episode',{SeriesId:'show'}),item('orphan','Episode')]};
    if(path.endsWith('/Latest'))return[item(String(query.ParentId),query.ParentId==='music'?'MusicAlbum':'Movie')];
    throw new Error('Unexpected endpoint');
  });
  const home=await api.getHome();
  assert.deepEqual(home.libraries.map(i=>i.Id),['movies','music','collections']);
  assert.deepEqual(home.sections.map(s=>[s.title,s.items.map(i=>i.Id)]),[['Continue watching',['resume']],['Next up',['next']],['Latest in Movies',['movies']],['Latest in Music',['music']]]);
  const resume=requests.find(r=>r.path.endsWith('/Resume'))!;
  assert.equal(resume.query.MediaTypes,'Video');
  assert.deepEqual(requests.filter(r=>r.path.endsWith('/Latest')).map(r=>r.query.ParentId),['movies','music']);
});

test('Home latest reads bound concurrency and preserve native library order',async()=>{
  let active=0,peak=0;
  const {api}=setup(({path,query})=>{
    if(path.endsWith('/Views'))return{Items:Array.from({length:7},(_,i)=>item(String(i),'CollectionFolder',{Name:`Library ${i}`,CollectionType:'movies'}))};
    if(path.endsWith('/Latest'))return(async()=>{peak=Math.max(peak,++active);await new Promise(resolve=>setTimeout(resolve,2));active--;return[item(String(query.ParentId),'Movie')];})();
    return{Items:[]};
  });
  const home=await api.getHome();
  assert.ok(peak<=3);assert.ok(peak>1);
  assert.deepEqual(home.sections.map(s=>s.items[0].Id),['0','1','2','3','4','5','6']);
});

test('Music queries use native artists endpoints and scoped server filters',async()=>{
  const {api,requests}=setup(({path})=>({Items:[item('artist',path==='Items'?'MusicAlbum':'MusicArtist')],TotalRecordCount:1}));
  await api.getMusic({kind:'albumArtists',parentId:'music',search:'  Moss ',favorite:true,genreId:'ambient',letter:'m'});
  await api.getMusic({kind:'artists',parentId:'music',letter:'#'});
  assert.equal(requests[0].path,'Artists/AlbumArtists');assert.equal(requests[1].path,'Artists');
  assert.equal(requests[0].query.ParentId,'music');assert.equal(requests[0].query.UserId,'user');
  assert.equal(requests[0].query.SearchTerm,'Moss');assert.equal(requests[0].query.GenreIds,'ambient');
  assert.equal(requests[0].query.IsFavorite,true);assert.equal(requests[0].query.NameStartsWith,'M');
  assert.equal(requests[1].query.NameLessThan,'A');assert.ok(!('IncludeItemTypes' in requests[0].query));
});

test('Music album contents use disc/track order and artist albums use native contributing-artist filtering',async()=>{
  const {api,requests}=setup(({query})=>({Items:[item('one',String(query.IncludeItemTypes)),item('missing',String(query.IncludeItemTypes),{PlayAccess:'None'})],TotalRecordCount:20}));
  const tracks=await api.getMusic({kind:'songs',parentId:'music',albumId:'album',startIndex:10,limit:20});
  assert.deepEqual(tracks.items.map(i=>i.Id),['one']);assert.equal(tracks.nextStartIndex,12);assert.equal(tracks.total,20);
  assert.equal(requests[0].query.ParentId,'album');assert.equal(requests[0].query.SortBy,'ParentIndexNumber,IndexNumber,SortName');
  assert.equal(requests[0].query.IncludeItemTypes,'Audio');
  await api.getMusic({kind:'albums',parentId:'music',artistId:'artist'});
  assert.equal(requests[1].query.ContributingArtistIds,'artist');assert.equal(requests[1].query.ParentId,'music');
  assert.equal(requests[1].query.IncludeItemTypes,'MusicAlbum');
});

test('Music page bounds and malformed totals cannot produce false empty states',async()=>{
  const {api,requests}=setup(()=>({Items:[],TotalRecordCount:0}));
  await api.getMusic({kind:'albums',limit:1000,startIndex:-4});
  assert.equal(requests[0].query.Limit,100);assert.equal(requests[0].query.StartIndex,0);
  await assert.rejects(api.getMusic({kind:'songs',letter:'XX'}),/choose a letter/i);
  const broken=setup(()=>({Items:[],TotalRecordCount:1}));
  await assert.rejects(broken.api.getMusic({kind:'albums'}),/incomplete music page/i);
});

test('Music genres paginate and suggestions retain native latest/listening-history sources',async()=>{
  const {api,requests}=setup(({path,query})=>{
    if(path==='MusicGenres')return{Items:[item(query.StartIndex?'jazz':'ambient','Genre')],TotalRecordCount:2};
    if(path.endsWith('/Latest'))return[item('album'),item('song','Audio')];
    return{Items:[item(String(query.SortBy),'Audio')]};
  });
  assert.deepEqual((await api.getMusicGenres('music')).map(i=>i.Id),['ambient','jazz']);
  assert.ok(requests.filter(r=>r.path==='MusicGenres').every(r=>r.query.ParentId==='music'&&r.query.IncludeItemTypes==='MusicAlbum'));
  const sections=await api.getMusicSuggestions('music');
  assert.deepEqual(sections.map(s=>s.title),['Recently added','Recently played','Frequently played']);
  assert.deepEqual(sections[0].items.map(i=>i.Type),['MusicAlbum','Audio']);
  assert.ok(requests.filter(r=>r.path==='Items').every(r=>r.query.ParentId==='music'&&r.query.Filters==='IsPlayed'&&r.query.IncludeItemTypes==='Audio'));
});

test('Recording status uses native unbounded active IDs and never relies on the unsupported false filter',async()=>{
  const recordings=[item('episode','Episode'),item('video','Video'),item('live','Movie',{Status:'InProgress'})];
  const {api,requests}=setup(({query})=>query.IsInProgress===true
    ?{Items:[recordings[2]],TotalRecordCount:1}
    :{Items:recordings.slice(Number(query.StartIndex),Number(query.StartIndex)+Number(query.Limit)),TotalRecordCount:3});
  const active=await api.getRecordings({status:'active',limit:1});
  assert.deepEqual(active,{items:[{...recordings[2],IsInProgress:true}],total:1,nextStartIndex:1});
  assert.equal(requests[0].path,'LiveTv/Recordings');assert.equal(requests[0].query.IsInProgress,true);
  assert.equal(requests[0].query.UserId,'user');assert.equal(requests[0].query.StartIndex,0);assert.ok(!('Limit' in requests[0].query));
  const completed=await api.getRecordings({status:'completed',startIndex:1,limit:1});
  assert.deepEqual(completed,{items:[{...recordings[1],IsInProgress:false}],total:2,nextStartIndex:2});
  const all=await api.getRecordings({startIndex:1,limit:2});
  assert.deepEqual(all.items.map(i=>[i.Id,i.IsInProgress]),[['video',false],['live',true]]);
  assert.equal(all.nextStartIndex,3);assert.equal(all.total,3);
  assert.ok(requests.every(r=>r.path==='LiveTv/Recordings'&&r.query.IsInProgress!==false));
});

test('Active recordings paginate locally when Jellyfin ignores Limit and return honest filtered totals',async()=>{
  const recordings=Array.from({length:60},(_,i)=>item(`active-${i}`,'Video',{Name:i%2?'Mountain':'Forest'}));
  const {api,requests}=setup(()=>({Items:recordings,TotalRecordCount:recordings.length}));
  const active=await api.getRecordings({status:'active',startIndex:48,limit:48});
  assert.equal(active.items.length,12);assert.equal(active.total,60);assert.equal(active.nextStartIndex,60);
  assert.equal(active.items[0].Id,'active-48');assert.equal(requests.length,1);assert.equal(requests[0].query.StartIndex,0);
  const searched=await api.getRecordings({status:'active',search:'mountain',startIndex:5,limit:3});
  assert.equal(searched.total,30);assert.equal(searched.nextStartIndex,8);assert.equal(searched.items[0].Id,'active-11');
  const incomplete=setup(()=>({Items:[item('one','Video')],TotalRecordCount:2}));
  await assert.rejects(incomplete.api.getRecordings({status:'active'}),/incomplete active recording/i);
});

test('Recording search traverses every server page instead of filtering only the visible page',async()=>{
  const {api,requests}=setup(({query})=>query.IsInProgress===true?{Items:[],TotalRecordCount:0}:{Items:[item(`recording-${query.StartIndex}`,'Recording',{Name:query.StartIndex===2?'Mountain trail':'Forest'})],TotalRecordCount:3});
  const result=await api.getRecordings({search:'mountain'});
  assert.equal(result.total,1);assert.equal(result.nextStartIndex,1);assert.equal(result.items[0].Id,'recording-2');
  assert.deepEqual(requests.filter(r=>r.query.IsInProgress!==true).map(r=>r.query.StartIndex),[0,1,2]);
  assert.ok(requests.every(r=>(r.query.IsInProgress===true||r.query.Limit===100)&&!('SearchTerm' in r.query)));
});

test('Recording search rejects repeated/incomplete reads without returning partial results',async()=>{
  const repeated=setup(({query})=>query.IsInProgress===true?{Items:[],TotalRecordCount:0}:{Items:[item('same','Recording')],TotalRecordCount:2});
  await assert.rejects(repeated.api.getRecordings({search:'same'}),/repeated a recording page/i);
  const partial=setup(({query})=>query.IsInProgress===true?{Items:[],TotalRecordCount:0}:query.StartIndex?{Items:[],TotalRecordCount:2}:{Items:[item('one','Recording')],TotalRecordCount:2});
  await assert.rejects(partial.api.getRecordings({search:'one'}),/incomplete recording page/i);
});

test('All browse reads use the caller session guard and reject failed sources',async()=>{
  let signedIn=true;
  const {client}=setup(()=>({Items:[],TotalRecordCount:0}));
  const api=createBrowseApi(client,'user',async action=>{if(!signedIn)throw new Error('Account changed');const value=await action();if(!signedIn)throw new Error('Account changed');return value;});
  signedIn=false;
  await assert.rejects(api.getHome(),/Account changed/);
  await assert.rejects(api.getMusic({kind:'albums'}),/Account changed/);
  await assert.rejects(api.getMusicGenres(),/Account changed/);
  await assert.rejects(api.getMusicSuggestions(),/Account changed/);
  await assert.rejects(api.getRecordings(),/Account changed/);
  const invalid=setup(()=>null);await assert.rejects(invalid.api.getHome(),/invalid library/i);
});
