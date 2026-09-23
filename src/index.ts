import styles from './style.css';
import guideStyles from './guide.css';
import { createJellyfinApi } from './api';
import { DetailView } from './view';

// TV Item Layout uses the remote and local-playback patterns from
// jampez77/InPlayerEpisodePreview-TV and Namo2/InPlayerEpisodePreview (MIT).
window.TvItemLayout?.destroy();
const sheet=document.createElement('style');sheet.dataset.tvItemLayout='';sheet.textContent=styles+guideStyles;document.head.append(sheet);
let view:DetailView|null=null;
let activeKey='';let dismissed='';let previousFocus:HTMLElement|null=null;
let timer:number|undefined;
let hiddenHost:HTMLElement|null=null;let previousAria:string|null=null;
function close(restore=true):void{
  view?.destroy();view=null;activeKey='';
  if(hiddenHost){if(previousAria===null)hiddenHost.removeAttribute('aria-hidden');else hiddenHost.setAttribute('aria-hidden',previousAria);hiddenHost=null;}
  if(document.body.classList.contains('tvl-open'))document.body.classList.remove('tvl-open');
  if(restore&&previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
}
function detailId():string|null{
  const route=location.hash.replace(/^#/,'');
  if(!/^\/?details(?:\?|$)/i.test(route))return null;
  return new URLSearchParams(route.split('?')[1]||'').get('id');
}
function dismiss():void{dismissed=location.hash;close();}
function refresh():void{
  const tv=document.documentElement.classList.contains('layout-tv')||document.body.classList.contains('layout-tv');
  const id=detailId();
  if(!tv||!id){dismissed='';close(false);return;}
  if(dismissed===location.hash)return;
  const api=window.TvItemLayoutDemo?.api||createJellyfinApi();
  if(!api){close(false);return;}
  if(activeKey===id&&view)return;
  close(false);activeKey=id;previousFocus=document.activeElement as HTMLElement;
  const host=document.querySelector<HTMLElement>('.itemDetailPage:not(.hide), #itemDetailPage:not(.hide)');
  if(host){hiddenHost=host;previousAria=host.getAttribute('aria-hidden');host.setAttribute('aria-hidden','true');}
  document.body.classList.add('tvl-open');
  view=new DetailView(api,{id,close:dismiss,back:()=>{if(window.TvItemLayoutDemo)dismiss();else history.back();},navigate:next=>{
    const params=new URLSearchParams(location.hash.split('?')[1]||'');params.set('id',next);location.hash=`/details?${params}`;
  }});
  document.body.append(view.element);void view.load();
}
const schedule=()=>{window.clearTimeout(timer);timer=window.setTimeout(refresh,30);};
const hide=(event:Event)=>{const target=event.target as HTMLElement;if(target.matches?.('.itemDetailPage, #itemDetailPage'))close(false);};
window.addEventListener('hashchange',schedule);window.addEventListener('popstate',schedule);
document.addEventListener('viewshow',schedule);document.addEventListener('viewbeforehide',hide,true);
const observer=new MutationObserver(schedule);
observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
observer.observe(document.body,{attributes:true,attributeFilter:['class']});
window.TvItemLayout={refresh,destroy(){close();sheet.remove();observer.disconnect();window.clearTimeout(timer);window.removeEventListener('hashchange',schedule);window.removeEventListener('popstate',schedule);document.removeEventListener('viewshow',schedule);document.removeEventListener('viewbeforehide',hide,true);}};
schedule();
