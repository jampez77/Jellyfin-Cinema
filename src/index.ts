import styles from './style.css';
import guideStyles from './guide.css';
import { createJellyfinApi } from './api';
import { DetailView } from './view';
import { GuideView } from './guide-view';

// TV Item Layout uses the remote and local-playback patterns from
// jampez77/InPlayerEpisodePreview-TV and Namo2/InPlayerEpisodePreview (MIT).
window.TvItemLayout?.destroy();
const sheet=document.createElement('style');sheet.dataset.tvItemLayout='';sheet.textContent=styles+guideStyles;document.head.append(sheet);
let view:DetailView|GuideView|null=null;
let activeKey='';let dismissed='';let previousFocus:HTMLElement|null=null;
let timer:number|undefined;
let hiddenHost:HTMLElement|null=null;let previousAria:string|null=null;
let returnFocus:{hash:string;id:string}|null=null;
const nativePages='.itemDetailPage, #itemDetailPage, .liveTvPage, #liveTvSuggestedPage';
type Route = {kind:'detail';id:string}|{kind:'guide'};
function close(restore=true):void{
  view?.destroy();view=null;activeKey='';
  if(hiddenHost){if(previousAria===null)hiddenHost.removeAttribute('aria-hidden');else hiddenHost.setAttribute('aria-hidden',previousAria);hiddenHost=null;}
  if(document.body.classList.contains('tvl-open'))document.body.classList.remove('tvl-open');
  if(restore&&previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
}
function currentRoute():Route|null{
  const [path,query='']=location.hash.replace(/^#\/?/,'').split('?');
  if(/^livetv\/?$/i.test(path))return {kind:'guide'};
  if(!/^details\/?$/i.test(path))return null;
  const id=new URLSearchParams(query).get('id');
  return id?{kind:'detail',id}:null;
}
function dismiss():void{dismissed=location.hash;close();}
function back():void{
  if(history.length>1)history.back();
  else location.hash='/home';
}
function hideNativeHost(route:Route):void{
  const selector=route.kind==='guide'?'.liveTvPage, #liveTvSuggestedPage':'.itemDetailPage, #itemDetailPage';
  const host=Array.from(document.querySelectorAll<HTMLElement>(selector)).find(node=>!node.classList.contains('hide')&&!node.hidden);
  if(!host||host===hiddenHost)return;
  if(hiddenHost){if(previousAria===null)hiddenHost.removeAttribute('aria-hidden');else hiddenHost.setAttribute('aria-hidden',previousAria);}
  hiddenHost=host;previousAria=host.getAttribute('aria-hidden');host.setAttribute('aria-hidden','true');
}
function refresh():void{
  const tv=document.documentElement.classList.contains('layout-tv')||document.body.classList.contains('layout-tv');
  const route=currentRoute();
  if(!tv||!route){dismissed='';close(false);return;}
  if(dismissed===location.hash)return;
  const api=window.TvItemLayoutDemo?.api||createJellyfinApi();
  if(!api){close(false);return;}
  const key=route.kind==='guide'?'guide':`detail:${route.id}`;
  if(activeKey===key&&view){hideNativeHost(route);return;}
  close(false);activeKey=key;previousFocus=document.activeElement as HTMLElement;
  hideNativeHost(route);
  document.body.classList.add('tvl-open');
  if(route.kind==='guide')view=new GuideView(api,{back});
  else {
    const focusId=returnFocus?.hash===location.hash?returnFocus.id:undefined;
    if(focusId)returnFocus=null;
    view=new DetailView(api,{id:route.id,close:dismiss,back:()=>{if(window.TvItemLayoutDemo)dismiss();else back();},focusId,navigate:next=>{
      const params=new URLSearchParams(location.hash.split('?')[1]||'');params.set('id',next);location.hash=`/details?${params}`;
    },openGuide:()=>{
      returnFocus={hash:location.hash,id:'guide'};
      const params=new URLSearchParams({collectionType:'livetv'});
      const serverId=new URLSearchParams(location.hash.split('?')[1]||'').get('serverId');
      if(serverId)params.set('serverId',serverId);
      location.hash=`/livetv?${params}`;
    }});
  }
  document.body.append(view.element);void view.load();
}
const schedule=()=>{window.clearTimeout(timer);timer=window.setTimeout(refresh,30);};
// Ignore a previous native view finishing its transition after the new overlay opens.
const hide=(event:Event)=>{if(event.target===hiddenHost)close(false);};
const show=(event:Event)=>{const target=event.target as HTMLElement;if(target.matches?.(nativePages))schedule();};
window.addEventListener('hashchange',schedule);window.addEventListener('popstate',schedule);
document.addEventListener('viewshow',show,true);document.addEventListener('viewbeforehide',hide,true);
const observer=new MutationObserver(schedule);
observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
observer.observe(document.body,{attributes:true,attributeFilter:['class']});
window.TvItemLayout={refresh,destroy(){close();sheet.remove();observer.disconnect();window.clearTimeout(timer);window.removeEventListener('hashchange',schedule);window.removeEventListener('popstate',schedule);document.removeEventListener('viewshow',show,true);document.removeEventListener('viewbeforehide',hide,true);}};
schedule();
