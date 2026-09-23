import styles from './style.css';
import guideStyles from './guide.css';
import themeVideoStyles from './theme-video.css';
import collectionStyles from './collection.css';
import { observeThemeVideo } from './theme-video';
import { createJellyfinApi } from './api';
import { DetailView } from './view';
import { GuideView } from './guide-view';
import { CollectionView } from './collection-view';
import type { MediaApi, Item } from './types';

// TV Item Layout uses the remote and local-playback patterns from
// jampez77/InPlayerEpisodePreview-TV and Namo2/InPlayerEpisodePreview (MIT).
window.TvItemLayout?.destroy();
const sheet=document.createElement('style');sheet.dataset.tvItemLayout='';sheet.textContent=styles+guideStyles+themeVideoStyles+collectionStyles;document.head.append(sheet);
let view:DetailView|GuideView|CollectionView|null=null;
let activeKey='';let dismissed='';let previousFocus:HTMLElement|null=null;
let timer:number|undefined;
let hiddenHost:HTMLElement|null=null;let previousAria:string|null=null;
const returnFocus=new Map<string,string>();
let pendingHash='';let probeRevision=0;
const movieLibraries=new WeakMap<HTMLElement,string>();
let stopThemeVideo: (() => void) | undefined;
const nativePages='.itemDetailPage, #itemDetailPage, .liveTvPage, #liveTvSuggestedPage, .mainAnimatedPage, #boxsetsPage, #moviesPage';
type CollectionRoute = {kind:'collections';parentId?:string;scope:'list'|'boxsets'|'movies';verifyParent?:boolean};
type Route = {kind:'detail';id:string}|{kind:'guide'}|CollectionRoute;
function close(restore=true):void{
  stopThemeVideo?.();stopThemeVideo=undefined;
  view?.destroy();view=null;activeKey='';
  if(hiddenHost){if(previousAria===null)hiddenHost.removeAttribute('aria-hidden');else hiddenHost.setAttribute('aria-hidden',previousAria);hiddenHost=null;}
  if(document.body.classList.contains('tvl-open'))document.body.classList.remove('tvl-open');
  if(restore&&previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
}
function currentRoute():Route|null{
  const [path,query='']=location.hash.replace(/^#\/?/,'').split('?');
  const params=new URLSearchParams(query);
  if(/^livetv\/?$/i.test(path))return {kind:'guide'};
  if(/^boxsets\/?$/i.test(path)){
    if(!onlyParams(params,['topParentId','serverId','collectionType','tab'])||(params.has('tab')&&params.get('tab')!=='0'))return null;
    return {kind:'collections',scope:'boxsets',parentId:params.get('topParentId')||undefined};
  }
  if(/^list\/?$/i.test(path)){
    // Do not replace a filtered search or an unrelated generic library list.
    const supported=['parentId','serverId','collectionType','type'];
    if(!onlyParams(params,supported))return null;
    if(params.get('type')&&params.get('type')!=='BoxSet')return null;
    const parentId=params.get('parentId')||undefined;
    if(params.get('type')==='BoxSet')return {kind:'collections',scope:'list',parentId};
    if(parentId)return {kind:'collections',scope:'list',parentId,verifyParent:true};
  }
  if(/^movies\/?$/i.test(path)){
    if(!onlyParams(params,['topParentId','serverId','collectionType','tab']))return null;
    const page=document.querySelector<HTMLElement>('#moviesPage:not(.hide)');
    const active=page&&movieLibraries.get(page)===(params.get('topParentId')||'')?page.querySelector('.pageTabContent.is-active'):null;
    if(active?active.id==='collectionsTab':params.get('tab')==='3')return {kind:'collections',scope:'movies',parentId:params.get('topParentId')||undefined};
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
  const selector=route.kind==='guide'?'.liveTvPage, #liveTvSuggestedPage':route.kind==='detail'?'.itemDetailPage, #itemDetailPage':route.scope==='movies'?'#moviesPage':route.scope==='boxsets'?'#boxsetsPage':'.mainAnimatedPage, [data-role="page"].libraryPage';
  const host=Array.from(document.querySelectorAll<HTMLElement>(selector)).find(node=>!node.classList.contains('hide')&&!node.hidden
    && (route.kind!=='collections'||route.scope!=='list'||!route.parentId||Array.from(node.querySelectorAll<HTMLElement>('.itemsContainer')).some(items=>items.dataset.parentid===route.parentId)));
  if(!host||host===hiddenHost)return;
  if(hiddenHost){if(previousAria===null)hiddenHost.removeAttribute('aria-hidden');else hiddenHost.setAttribute('aria-hidden',previousAria);}
  hiddenHost=host;previousAria=host.getAttribute('aria-hidden');host.setAttribute('aria-hidden','true');
}
function refresh():void{
  const tv=document.documentElement.classList.contains('layout-tv')||document.body.classList.contains('layout-tv');
  const route=currentRoute();
  if(pendingHash && pendingHash!==location.hash){pendingHash='';probeRevision++;}
  if(!tv||!route){dismissed='';pendingHash='';probeRevision++;close(false);return;}
  if(dismissed===location.hash)return;
  const api=window.TvItemLayoutDemo?.api||createJellyfinApi();
  if(!api){close(false);return;}
  const key=route.kind==='guide'?'guide':route.kind==='detail'?`detail:${route.id}`:`collections:${route.scope}:${route.parentId||''}`;
  if(activeKey===key&&view){hideNativeHost(route);return;}
  if(route.kind==='collections'&&route.verifyParent){
    if(pendingHash===location.hash)return;
    close(false);
    const hash=location.hash;pendingHash=hash;const revision=++probeRevision;
    void api.getItem(route.parentId!).then(parent=>{
      if(revision!==probeRevision||location.hash!==hash)return;
      pendingHash='';
      if(parent.CollectionType==='boxsets')openRoute(route,api,key);
      else dismissed=hash;
    }).catch(()=>{if(revision===probeRevision){pendingHash='';dismissed=hash;}});
    return;
  }
  openRoute(route,api,key);
}
function rememberFocus(id=(document.activeElement as HTMLElement)?.dataset.focusId):void{
  if(id)returnFocus.set(location.hash,id);
  if(returnFocus.size>100)returnFocus.delete(returnFocus.keys().next().value!);
}
function navigate(next:string):void{
  rememberFocus();
  const params=new URLSearchParams({id:next});
  const serverId=new URLSearchParams(location.hash.split('?')[1]||'').get('serverId');
  if(serverId)params.set('serverId',serverId);
  location.hash=`/details?${params}`;
}
function collectionBack(route:CollectionRoute):void{
  if(route.scope==='movies'){
    const tabs=document.querySelector<HTMLElement>('.tabs-viewmenubar') as (HTMLElement & {selectedIndex?:(index:number)=>void})|null;
    if(tabs?.selectedIndex){close(false);tabs.selectedIndex(0);tabs.querySelector<HTMLElement>('.emby-tab-button[data-index="0"]')?.focus({preventScroll:true});schedule();return;}
  }
  back();
}
function openRoute(route:Route,api:MediaApi,key:string):void{
  close(false);activeKey=key;previousFocus=document.activeElement as HTMLElement;
  hideNativeHost(route);
  document.body.classList.add('tvl-open');
  const focusId=returnFocus.get(location.hash);returnFocus.delete(location.hash);
  if(route.kind==='guide')view=new GuideView(api,{back});
  else if(route.kind==='collections')view=new CollectionView(api,{parentId:route.parentId,back:()=>collectionBack(route),navigate,focusId});
  else {
    const openCollection=(item:Item)=>{
      stopThemeVideo?.();stopThemeVideo=undefined;view?.destroy();
      view=new CollectionView(api,{item,back,navigate,focusId});
      document.body.append(view.element);void view.load();
    };
    view=new DetailView(api,{id:route.id,close:dismiss,back:()=>{if(window.TvItemLayoutDemo)dismiss();else back();},focusId,navigate,openCollection,openGuide:()=>{
      rememberFocus('guide');
      const params=new URLSearchParams({collectionType:'livetv'});
      const serverId=new URLSearchParams(location.hash.split('?')[1]||'').get('serverId');
      if(serverId)params.set('serverId',serverId);
      location.hash=`/livetv?${params}`;
    }});
  }
  document.body.append(view.element);
  if(route.kind==='detail')stopThemeVideo=observeThemeVideo(view.element);
  void view.load();
}
const schedule=()=>{window.clearTimeout(timer);timer=window.setTimeout(refresh,30);};
// Ignore a previous native view finishing its transition after the new overlay opens.
const hide=(event:Event)=>{if(event.target===hiddenHost)close(false);};
const show=(event:Event)=>{
  const target=event.target as HTMLElement;
  if(target.id==='moviesPage')movieLibraries.set(target,(event as CustomEvent).detail?.params?.topParentId||'');
  if(target.matches?.(nativePages))schedule();
};
window.addEventListener('hashchange',schedule);window.addEventListener('popstate',schedule);
document.addEventListener('viewshow',show,true);document.addEventListener('viewbeforehide',hide,true);
document.addEventListener('tabchange',schedule,true);
const observer=new MutationObserver(schedule);
observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
observer.observe(document.body,{attributes:true,attributeFilter:['class']});
window.TvItemLayout={refresh,destroy(){probeRevision++;pendingHash='';close();sheet.remove();observer.disconnect();window.clearTimeout(timer);window.removeEventListener('hashchange',schedule);window.removeEventListener('popstate',schedule);document.removeEventListener('viewshow',show,true);document.removeEventListener('viewbeforehide',hide,true);document.removeEventListener('tabchange',schedule,true);}};
schedule();
