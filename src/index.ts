import styles from './style.css';
import { isCinemaLayout } from './layout';
import { DesktopPlayer } from './desktop-player';
import guideStyles from './guide.css';
import themeVideoStyles from './theme-video.css';
import collectionStyles from './collection.css';
import libraryStyles from './library.css';
import nativeHostStyles from './native-host.css';
import browseStyles from './browse.css';
import recordingsStyles from './recordings.css';
import musicPlayerStyles from './music-player.css';
import { NativeRecordingsTheme } from './native-recordings';
import { ProfileMenu } from './profile-menu';
import profileMenuStyles from './profile-menu.css';
import { NativeFolderTheme } from './native-folder';
import nativeFolderStyles from './native-folder.css';
import { NativeLoginTheme } from './native-login';
import loginStyles from './login.css';
import { NativeUserPages } from './native-user-pages';
import nativeUserPageStyles from './native-user-pages.css';
import homeStyles from './home.css';
import homeCollectionStyles from './home-collections.css';
import { HomeCollections } from './home-collections';
import pauseStyles from './pause-screen.css';
import playerStyles from './player-browser.css';
import { NativeHostMask } from './native-host';
import { observeThemeVideo } from './theme-video';
import { createJellyfinApi } from './api';
import { DetailView } from './view';
import { GuideView } from './guide-view';
import { CollectionView } from './collection-view';
import { LibraryView, type LibraryTab, type LibraryBrowseState } from './library-view';
import { BrowseView, type BrowseTab, type BrowseState } from './browse-view';
import { createPlayerContext } from './player-context';
import { PlayerBrowser } from './player-browser';
import { startPauseScreen } from './pause-screen';
import type { MediaApi, Item } from './types';

// TV Item Layout uses the remote and local-playback patterns from
// jampez77/InPlayerEpisodePreview-TV and Namo2/InPlayerEpisodePreview (MIT).
window.TvItemLayout?.destroy();
const sheet=document.createElement('style');sheet.dataset.tvItemLayout='';sheet.textContent=styles+guideStyles+themeVideoStyles+collectionStyles+libraryStyles+nativeHostStyles+browseStyles+recordingsStyles+musicPlayerStyles+homeStyles+homeCollectionStyles+pauseStyles+playerStyles+profileMenuStyles+nativeFolderStyles+loginStyles+nativeUserPageStyles;document.head.append(sheet);
let view:DetailView|GuideView|CollectionView|LibraryView|BrowseView|null=null;
let homeCollections:HomeCollections|null=null;
let activeKey='';let openedHash='';let dismissed='';let previousFocus:HTMLElement|null=null;
let timer:number|undefined;
let disposed=false;
let accountScope:string|null|undefined;
const nativeHostMask=new NativeHostMask();
const nativeRecordingsTheme=new NativeRecordingsTheme();
const profileMenu=new ProfileMenu();
const desktopPlayer=new DesktopPlayer();
const nativeFolderTheme=new NativeFolderTheme();
const nativeLoginTheme=new NativeLoginTheme();
const nativeUserPages=new NativeUserPages();
const returnFocus=new Map<string,string>();
let pendingHash='';let probeRevision=0;
const libraryStates=new Map<string,LibraryBrowseState>();
const browseStates=new Map<string,BrowseState>();
const recordingOrigins=new Set<string>();
const movieCollectionOrigins=new Map<string,string>();
const detailOrigins=new Set<string>();
let stopThemeVideo: (() => void) | undefined;
const nativePages='.itemDetailPage, #itemDetailPage, .liveTvPage, #liveTvSuggestedPage, .mainAnimatedPage, #boxsetsPage, #moviesPage, #tvRecommendedPage, #indexPage, #musicRecommendedPage';
type CollectionRoute = {kind:'collections';parentId?:string;scope:'list'|'boxsets'|'movies';verifyParent?:boolean};
type BrowseRoute = ({kind:'home'}|{kind:'music'}|{kind:'recordings'}) & {parentId?:string;tab?:BrowseTab;scope?:'list'|'livetv'};
type Route = {kind:'detail';id:string}|{kind:'guide'}|{kind:'movies';parentId?:string;tab:LibraryTab}|{kind:'shows';parentId?:string;tab:LibraryTab}|CollectionRoute|BrowseRoute;
function close(restore=true):void{
  homeCollections?.destroy();homeCollections=null;
  stopThemeVideo?.();stopThemeVideo=undefined;
  view?.destroy();view=null;activeKey='';openedHash='';
  nativeHostMask.clear();
  if(document.body.classList.contains('tvl-open'))document.body.classList.remove('tvl-open');
  if(document.body.classList.contains('tvl-home'))document.body.classList.remove('tvl-home');
  if(restore&&previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
}
function currentRoute():Route|null{
  const [path,query='']=location.hash.replace(/^#\/?/,'').split('?');
  const params=new URLSearchParams(query);
  if(/^home\/?$/i.test(path)){
    // Home/Favourites switch native controllers without changing the URL.
    // Both retain their native tabs, focus handling and content ownership.
    if(!onlyParams(params,['serverId','tab'])||(params.has('tab')&&!['0','1'].includes(params.get('tab')!)))return null;
    return {kind:'home'};
  }
  if(/^music\/?$/i.test(path)){
    if(!onlyParams(params,['topParentId','serverId','collectionType','tab']))return null;
    const tabs:Record<string,BrowseTab>={'0':'albums','1':'suggestions','2':'albumArtists','3':'artists','4':'playlists','5':'songs','6':'genres'};
    const tab=tabs[params.get('tab')||'0'];
    return tab?{kind:'music',parentId:params.get('topParentId')||undefined,tab}:null;
  }
  if(/^livetv\/?$/i.test(path)){
    if(!onlyParams(params,['topParentId','serverId','collectionType','tab']))return null;
    const tab=params.get('tab')||'0';
    if(tab==='3')return {kind:'recordings',scope:'livetv'};
    return tab==='0'||tab==='1'?{kind:'guide'}:null;
  }
  if(/^boxsets\/?$/i.test(path)){
    if(!onlyParams(params,['topParentId','serverId','collectionType','tab'])||(params.has('tab')&&params.get('tab')!=='0'))return null;
    return {kind:'collections',scope:'boxsets',parentId:params.get('topParentId')||undefined};
  }
  if(/^list\/?$/i.test(path)){
    // Do not replace a filtered search or an unrelated generic library list.
    const supported=['parentId','serverId','collectionType','type'];
    if(!onlyParams(params,supported))return null;
    if(params.get('type')==='Recordings')return {kind:'recordings',scope:'list',parentId:params.get('parentId')||undefined};
    if(params.get('type')&&params.get('type')!=='BoxSet')return null;
    const parentId=params.get('parentId')||undefined;
    if(params.get('type')==='BoxSet')return {kind:'collections',scope:'list',parentId};
    if(parentId)return {kind:'collections',scope:'list',parentId,verifyParent:true};
  }
  if(/^movies\/?$/i.test(path)){
    if(!onlyParams(params,['topParentId','serverId','collectionType','tab']))return null;
    const parentId=params.get('topParentId')||undefined;
    const tab=params.get('tab')||'1';
    if(tab==='3')return {kind:'collections',scope:'movies',parentId};
    const tabs:Record<string,LibraryTab>={'0':'all','1':'suggestions','2':'favorites','4':'genres'};
    if(tabs[tab])return {kind:'movies',parentId,tab:tabs[tab]};
  }
  if(/^tv\/?$/i.test(path)){
    if(!onlyParams(params,['topParentId','serverId','collectionType','tab']))return null;
    const tabs:Record<string,LibraryTab>={'0':'all','1':'suggestions','3':'genres'};
    const tab=tabs[params.get('tab')||'1'];
    if(tab)return {kind:'shows',parentId:params.get('topParentId')||undefined,tab};
  }
  if(!/^details\/?$/i.test(path))return null;
  const id=params.get('id');
  return id?{kind:'detail',id}:null;
}
function onlyParams(params:URLSearchParams,allowed:string[]):boolean{
  let supported=true;params.forEach((_value,key)=>{if(!allowed.includes(key))supported=false;});return supported;
}
function dismiss():void{dismissed=location.hash;close();}
function back():void{
  if(history.length>1)history.back();
  else location.hash='/home';
}
function hideNativeHost(route:Route):void{
  if(route.kind==='home')return;
  const selector=route.kind==='music'?'#musicRecommendedPage':route.kind==='guide'||route.kind==='recordings'&&route.scope==='livetv'?'.liveTvPage, #liveTvSuggestedPage':route.kind==='detail'?'.itemDetailPage, #itemDetailPage':route.kind==='shows'?'#tvRecommendedPage':route.kind==='movies'||route.kind==='collections'&&route.scope==='movies'?'#moviesPage':route.kind==='collections'&&route.scope==='boxsets'?'#boxsetsPage':'.mainAnimatedPage, [data-role="page"].libraryPage';
  nativeHostMask.setSelector(selector);
}
function scopeOf(api:MediaApi|null):string|null{
  return api?JSON.stringify([api.serverId||'',api.userId||'']):null;
}
function updateAccount(api:MediaApi|null):void{
  const scope=scopeOf(api);
  if(accountScope===scope)return;
  // Dispose first: views save their final state during destruction. Clear that
  // outgoing account's state afterwards, before mounting any new account view.
  probeRevision++;pendingHash='';close(false);accountScope=scope;dismissed='';previousFocus=null;
  returnFocus.clear();libraryStates.clear();browseStates.clear();
  recordingOrigins.clear();movieCollectionOrigins.clear();detailOrigins.clear();
}
function refresh():void{
  if(disposed)return;
  const api=getPlayerApi();
  updateAccount(api);
  const cinema=isCinemaLayout();
  if(document.body.classList.contains('tvl-layout')!==cinema)document.body.classList.toggle('tvl-layout',cinema);
  nativeRecordingsTheme.update(cinema && !!api);
  profileMenu.update(cinema && !!api, scopeOf(api));
  nativeFolderTheme.update(cinema && !!api, scopeOf(api));
  nativeLoginTheme.update(cinema);
  nativeUserPages.update(cinema && !!api, scopeOf(api));
  const route=currentRoute();
  if(pendingHash && pendingHash!==location.hash){pendingHash='';probeRevision++;}
  if(!cinema||!route){dismissed='';pendingHash='';probeRevision++;close(false);return;}
  if(dismissed===location.hash)return;
  if(!api){close(false);return;}
  const scope=scopeOf(api);
  const key=`${scope}:${route.kind}:${location.hash}`;
  if(activeKey===key&&(view||route.kind==='home')){if(view)hideNativeHost(route);return;}
  if(route.kind==='collections'&&route.verifyParent){
    if(pendingHash===location.hash)return;
    close(false);
    const hash=location.hash;pendingHash=hash;const revision=++probeRevision;
    void api.getItem(route.parentId!).then(async parent=>{
      if(revision!==probeRevision||location.hash!==hash||scopeOf(getPlayerApi())!==scope)return;
      if(parent.CollectionType==='boxsets'){
        pendingHash='';openRoute(route,api,key);return;
      }
      // DVR recognition can be unavailable to a library-only account. The
      // ordinary native folder still gets styling without gaining DVR access.
      let recordingFolder=false;
      try { recordingFolder=!!await api.isRecordingFolder?.(parent.Id); } catch { /* Retain the native folder. */ }
      if(revision!==probeRevision||location.hash!==hash||scopeOf(getPlayerApi())!==scope)return;
      pendingHash='';
      if(recordingFolder)openRoute({kind:'recordings',scope:'list',parentId:parent.Id},api,key);
      else {
        if(parent.IsFolder || ['Folder','CollectionFolder','UserView'].includes(parent.Type || '')) nativeFolderTheme.show(parent.Id,parent.Name);
        dismissed=hash;
      }
    }).catch(()=>{if(revision===probeRevision){pendingHash='';dismissed=hash;}});
    return;
  }
  openRoute(route,api,key);
}
function rememberFocus(id=(document.activeElement as HTMLElement)?.dataset.focusId):void{
  if(id)returnFocus.set(location.hash,id);
  if(returnFocus.size>100)returnFocus.delete(returnFocus.keys().next().value!);
}
function navigate(next:string,activeServerId?:string,fromRecording=false):void{
  rememberFocus();
  const params=new URLSearchParams({id:next});
  const serverId=new URLSearchParams(location.hash.split('?')[1]||'').get('serverId')||activeServerId;
  if(serverId)params.set('serverId',serverId);
  detailOrigins.add(`#/details?${params}`);
  if(fromRecording)recordingOrigins.add(`#/details?${params}`);
  else recordingOrigins.delete(`#/details?${params}`);
  if(recordingOrigins.size>100)recordingOrigins.delete(recordingOrigins.values().next().value!);
  if(detailOrigins.size>100)detailOrigins.delete(detailOrigins.values().next().value!);
  location.hash=`/details?${params}`;
}
function collectionBack(route:CollectionRoute):void{
  if(route.scope==='movies'){
    if(movieCollectionOrigins.has(location.hash)){back();return;}
    const params=new URLSearchParams(location.hash.split('?')[1]||'');params.set('tab','0');
    history.replaceState(null,'',`#/movies?${params}`);schedule();return;
  }
  back();
}
function openRoute(route:Route,api:MediaApi,key:string):void{
  close(false);activeKey=key;openedHash=location.hash;previousFocus=document.activeElement as HTMLElement;
  const focusId=returnFocus.get(location.hash);returnFocus.delete(location.hash);
  if(route.kind==='home'){
    // Keep Jellyfin's Home in place. Its controllers own user/device settings,
    // section order, hidden libraries, focus and Featured's carousel lifecycle.
    // Styling alone also works when the native page arrives after this route.
    document.body.classList.add('tvl-home');
    homeCollections=new HomeCollections(api,id=>navigate(id,api.serverId),focusId);return;
  }
  hideNativeHost(route);
  document.body.classList.add('tvl-open');
  const go=(id:string)=>navigate(id,api.serverId,route.kind==='recordings');
  const navigateRoute=(hash:string)=>{
    rememberFocus();
    const [path,query='']=hash.replace(/^#/,'').split('?');
    const params=new URLSearchParams(query);
    const serverId=new URLSearchParams(location.hash.split('?')[1]||'').get('serverId')||api.serverId;
    if(serverId&&!params.has('serverId'))params.set('serverId',serverId);
    location.hash=path+(params.toString()?`?${params}`:'');
  };
  if(route.kind==='guide')view=new GuideView(api,{back});
  else if(route.kind==='collections')view=new CollectionView(api,{parentId:route.parentId,back:()=>collectionBack(route),navigate:go,focusId});
  else if(route.kind==='movies'||route.kind==='shows'){
    const hash=location.hash;
    view=new LibraryView(api,{kind:route.kind,parentId:route.parentId,initialTab:route.tab,back,navigate:go,focusId,state:libraryStates.get(hash),onState:state=>{
      libraryStates.set(hash,state);
      if(libraryStates.size>100)libraryStates.delete(libraryStates.keys().next().value!);
    },openCollections:()=>{
      rememberFocus('collections');
      const params=new URLSearchParams(hash.split('?')[1]||'');
      if(route.kind==='shows'){
        const collections=new URLSearchParams();
        if(route.parentId)collections.set('parentId',route.parentId);
        collections.set('type','BoxSet');
        const serverId=params.get('serverId')||api.serverId;
        if(serverId)collections.set('serverId',serverId);
        location.hash=`/list?${collections}`;return;
      }
      params.set('tab','3');
      const target=`#/movies?${params}`;movieCollectionOrigins.set(target,hash);
      if(movieCollectionOrigins.size>100)movieCollectionOrigins.delete(movieCollectionOrigins.keys().next().value!);
      location.hash=target;
    }});
  }
  else if(route.kind==='music'||route.kind==='recordings'){
    const hash=location.hash;
    view=new BrowseView(api,{...route,back,navigate:go,navigateRoute,focusId,state:browseStates.get(hash),onState:state=>{
      browseStates.set(hash,state);
      if(browseStates.size>100)browseStates.delete(browseStates.keys().next().value!);
    }});
  }
  else {
    const openCollection=(item:Item)=>{
      stopThemeVideo?.();stopThemeVideo=undefined;view?.destroy();
      view=new CollectionView(api,{item,back,navigate:go,focusId});
      document.body.append(view.element);void view.load();
    };
    const openAdditional=(item:Item):boolean=>{
      const kind=['MusicAlbum','MusicArtist','Audio','Playlist'].includes(item.Type||'')?'music'
        :recordingOrigins.has(location.hash)||['Video','Recording'].includes(item.Type||'')||item.Type==='Episode'&&!item.SeriesId?'recordings':null;
      if(!kind)return false;
      stopThemeVideo?.();stopThemeVideo=undefined;view?.destroy();
      view=new BrowseView(api,{kind,item,back,navigate:go,navigateRoute,focusId});
      document.body.append(view.element);void view.load();return true;
    };
    view=new DetailView(api,{id:route.id,close:dismiss,back:()=>{if(window.TvItemLayoutDemo&&!detailOrigins.has(location.hash))dismiss();else back();},focusId,navigate:go,openCollection,openAdditional,openGuide:()=>{
      rememberFocus('guide');
      const params=new URLSearchParams({collectionType:'livetv'});
      const serverId=new URLSearchParams(location.hash.split('?')[1]||'').get('serverId')||api.serverId;
      if(serverId)params.set('serverId',serverId);
      location.hash=`/livetv?${params}`;
    }});
  }
  document.body.append(view.element);
  if(route.kind==='detail')stopThemeVideo=observeThemeVideo(view.element);
  void view.load();
}
const schedule=()=>{if(disposed)return;window.clearTimeout(timer);timer=window.setTimeout(refresh,30);};
// Native cached pages rotate DOM slots, so DOM order cannot identify the owner.
// A hide event on the overlay's current route belongs to an outgoing native
// transition. Release the overlay once navigation has actually left its route.
const hide=(event:Event)=>{if(location.hash!==openedHash&&nativeHostMask.owns(event.target))close(false);};
const show=(event:Event)=>{
  const target=event.target as HTMLElement;
  if(target.matches?.(nativePages))schedule();
};
const hashChanged=(event:HashChangeEvent)=>{
  if(dismissed!==location.hash)dismissed='';
  // The offline preview also has native Home/Featured links. Distinguish those
  // entries from a direct detail preview, whose Back dismisses the demo overlay.
  if(window.TvItemLayoutDemo&&/^#\/home(?:\?|$)/.test(new URL(event.oldURL,location.href).hash)&&/^#\/details\?/.test(location.hash)){
    detailOrigins.add(location.hash);
    if(detailOrigins.size>100)detailOrigins.delete(detailOrigins.values().next().value!);
  }
  schedule();
};
window.addEventListener('hashchange',hashChanged);window.addEventListener('popstate',schedule);
document.addEventListener('viewshow',show,true);document.addEventListener('viewbeforehide',hide,true);
document.addEventListener('tabchange',schedule,true);
const observer=new MutationObserver(schedule);
observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
observer.observe(document.body,{attributes:true,attributeFilter:['class']});
const getPlayerApi=()=>window.TvItemLayoutDemo?.api||createJellyfinApi();
const playerContext=createPlayerContext(getPlayerApi);
const playerBrowser=new PlayerBrowser(playerContext,getPlayerApi);
const stopPauseScreen=startPauseScreen({getApi:getPlayerApi,getPlayback:playerContext.getSnapshot,subscribe:playerContext.subscribe});
// Jellyfin's account events live on its private module event bus. Poll only
// identity so sign-out/server switches also clear non-player pages promptly.
const scopeTimer=window.setInterval(()=>{if(scopeOf(getPlayerApi())!==accountScope)refresh();},1000);
window.TvItemLayout={refresh,destroy(){disposed=true;probeRevision++;pendingHash='';stopPauseScreen();nativeRecordingsTheme.destroy();profileMenu.destroy();desktopPlayer.destroy();nativeFolderTheme.destroy();nativeLoginTheme.destroy();nativeUserPages.destroy();playerBrowser.destroy();playerContext.destroy();close();sheet.remove();observer.disconnect();document.body.classList.remove('tvl-layout');window.clearTimeout(timer);window.clearInterval(scopeTimer);window.removeEventListener('hashchange',hashChanged);window.removeEventListener('popstate',schedule);document.removeEventListener('viewshow',show,true);document.removeEventListener('viewbeforehide',hide,true);document.removeEventListener('tabchange',schedule,true);}};
schedule();
