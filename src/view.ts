import type { Item, MediaApi } from './types';
import { el, icon, button, picture, replace } from './dom';
import { runtime, progress, seasonName, episodeCode, time, programmeProgress, playable, plainText } from './utils';
import { attachRemote } from './remote';

type Pane = 'overview' | 'episodes' | 'similar';
export class DetailView {
  readonly element = el('section', 'tvl-root tvl-keyboard');
  private content = el('div', 'tvl-content');
  private status = el('div', 'tvl-status');
  private item!: Item;
  private target: Item | null = null;
  private seasons: Item[] = [];
  private selectedSeason?: Item;
  private episodes = new Map<string, Item[]>();
  private similar: Item[] = [];
  private pane: Pane = 'overview';
  private disposed = false;
  private revision = 0;
  private loadingRevision = 0;
  private removeRemote: () => void;
  private launchTimer?: number;
  private liveTimer?: number;
  private launching = false;
  private favoritePending = false;
  private restoreId = '';

  constructor(private api: MediaApi, private options: { id: string; close: () => void; back: () => void; navigate: (id: string) => void; openGuide: () => void; focusId?: string }) {
    this.restoreId = options.focusId || '';
    this.element.id = 'tv-layout';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', 'Media details');
    this.status.setAttribute('role','status');
    this.status.setAttribute('aria-live','polite');
    this.element.append(this.content, this.status);
    this.removeRemote = attachRemote(this.element, () => this.back(), direction=>this.moveBetweenSeasons(direction));
  }
  async load(): Promise<void> {
    this.content.append(this.header(), el('div', 'tvl-loading', 'Loading your library…'));
    this.focusFirst();
    try {
      const requested = await this.api.getItem(this.options.id);
      if (this.disposed) return;
      this.item = requested;
      if (requested.Type === 'Season' || requested.Type === 'Episode') {
        if (!requested.SeriesId) { this.options.close(); return; }
        this.item = await this.api.getItem(requested.SeriesId);
        if (requested.Type === 'Episode' && playable(requested)) this.target = requested;
      } else if (requested.Type === 'Program') {
        if (!requested.ChannelId) { this.options.close(); return; }
        this.item = await this.api.getItem(requested.ChannelId);
      }
      if (this.disposed) return;
      if (!['Movie','Series','TvChannel'].includes(this.item.Type || '')) { this.options.close(); return; }
      this.element.setAttribute('aria-label', `${this.item.Name} details`);
      if (this.item.Type === 'Series') {
        // Main metadata remains usable while season and next-up requests load.
        const [seasons, next] = await Promise.allSettled([this.api.getSeasons(this.item.Id), this.api.getNextEpisode(this.item.Id)]);
        if (this.disposed) return;
        this.seasons = seasons.status === 'fulfilled' ? seasons.value : [];
        this.target ||= next.status === 'fulfilled' ? next.value : null;
        this.selectedSeason = this.seasons.find(s => s.Id === (requested.Type === 'Season' ? requested.Id : this.target?.SeasonId))
          || this.seasons.find(s => s.IndexNumber === this.target?.ParentIndexNumber) || this.seasons.find(s => s.IndexNumber !== 0) || this.seasons[0];
        if (!this.target && this.selectedSeason) {
          // Empty first seasons should not hide playable episodes in later ones.
          const ordered = [this.selectedSeason, ...this.seasons.filter(s => s.Id !== this.selectedSeason?.Id)];
          for (const season of ordered) {
            try {
              this.target = (await this.fetchEpisodes(season))[0] || null;
              if (this.disposed) return;
              if (this.target) { if (requested.Type !== 'Season') this.selectedSeason=season; break; }
            } catch { /* Episodes has its own retry state. */ }
          }
        }
        if (seasons.status === 'rejected') this.announce('Seasons could not be loaded. Reopen the details to retry.');
      } else this.target = this.item;
      if (this.disposed) return;
      this.setBackdrop();
      if (requested.Type === 'Season') this.pane = 'episodes';
      this.render();
      if (this.item.Type === 'TvChannel') {
        this.liveTimer = window.setInterval(() => { void this.refreshChannel(); }, 60_000);
      }
    } catch {
      if (this.disposed) return;
      replace(this.content,this.header());
      const error = el('div','tvl-empty');
      error.append(el('h1','','Unable to load this title'), el('p','','Check your connection and try again.'),
        button('Try again','', 'tvl-primary', () => { replace(this.content); void this.load(); }));
      this.content.append(error); this.focusFirst();
    }
  }
  private async refreshChannel(): Promise<void> {
    try {
      const refreshed = await this.api.getItem(this.item.Id);
      if (this.disposed) return;
      const changed = refreshed.CurrentProgram?.Id !== this.item.CurrentProgram?.Id;
      this.item = refreshed; this.target = refreshed;
      if (changed && this.pane === 'overview' && !this.launching) { this.setBackdrop(); this.render(); }
      else if(this.pane === 'overview') this.element.querySelectorAll<HTMLElement>('[data-live-progress]').forEach(node => {
        node.style.width = `${programmeProgress(this.item.CurrentProgram || this.item)}%`;
      });
    } catch { /* Keep the guide visible during a temporary disconnect. */ }
  }
  private setBackdrop(): void {
    this.element.querySelector('.tvl-backdrop')?.remove();
    const subject = this.item.CurrentProgram || this.item;
    const backdrop = picture(this.api.image(subject,'backdrop') || this.api.image(this.item,'backdrop'), 'tvl-backdrop');
    this.element.prepend(backdrop);
  }
  private header(): HTMLElement {
    const header = el('header','tvl-header');
    const back = button(this.pane === 'overview' ? 'Back' : 'Overview','back','tvl-back', () => this.back());
    header.append(back);
    return header;
  }
  private title(compact = false): HTMLElement {
    const node = el('div',`tvl-title-wrap${compact ? ' tvl-title-compact' : ''}`);
    const logo = this.api.image(this.item,'logo');
    if (logo) {
      const image = el('img','tvl-logo'); image.src = logo; image.alt = this.item.Name;
      image.addEventListener('error', () => image.replaceWith(el('h1','tvl-title',this.item.Name)), {once:true});
      node.append(image);
    } else node.append(el('h1','tvl-title',this.item.Name));
    return node;
  }
  private meta(item = this.item): HTMLElement {
    const row = el('div','tvl-meta');
    if (item.ProductionYear) row.append(el('span','',String(item.ProductionYear)));
    if (item.OfficialRating) row.append(el('span','tvl-rating',item.OfficialRating));
    const duration = item.Type === 'Series' ? `${this.seasons.filter(s => s.IndexNumber !== 0).length} seasons` : runtime(item.RunTimeTicks);
    if (duration && duration !== '0 seasons') row.append(el('span','',duration));
    const width = Math.max(0,...(item.MediaStreams || []).filter(s => s.Type === 'Video').map(s => s.Width || 0));
    if (width >= 1280) row.append(el('span','tvl-quality',width >= 3840 ? '4K' : 'HD'));
    if (item.CommunityRating) row.append(el('span','tvl-community',`★ ${item.CommunityRating.toFixed(1)}`));
    return row;
  }
  private render(): void {
    if (this.disposed) return;
    this.revision++;
    this.element.dataset.pane = this.pane;
    this.element.dataset.kind = this.item.Type;
    replace(this.content,this.header());
    if (this.pane === 'episodes') void this.renderEpisodes();
    else if (this.pane === 'similar') void this.renderSimilar();
    else this.renderOverview();
  }
  private renderOverview(): void {
    const movie = this.item.Type === 'Movie';
    const live = this.item.Type === 'TvChannel';
    const hero = el('main',`tvl-hero${movie ? ' tvl-movie-hero' : ''}`);
    const body = el('div','tvl-hero-copy');
    if (live) {
      const eyebrow = el('div','tvl-eyebrow');
      eyebrow.append(el('span','tvl-live-dot'), el('span','','LIVE TV'), el('span','tvl-eyebrow-divider','/'), el('span','',this.item.ChannelNumber || this.item.Number || 'ON AIR'));
      body.append(eyebrow);
    }
    body.append(this.title());
    const programme = this.item.CurrentProgram;
    if (live) {
      body.append(el('h2','tvl-episode-name', programme?.Name || 'Live on this channel'));
      const times = el('div','tvl-meta');
      if (programme?.StartDate && programme.EndDate) times.append(el('span','',`${time(programme.StartDate)} – ${time(programme.EndDate)}`));
      times.append(el('span','tvl-on-air','Live now')); body.append(times);
    } else body.append(this.meta());
    if (!live && !movie && this.target) body.append(el('h2','tvl-episode-name',`${episodeCode(this.target)}${episodeCode(this.target) ? '  ' : ''}${this.target.Name}`));
    const summary = live ? programme?.Overview || this.item.Overview : this.item.Overview;
    body.append(el('p','tvl-synopsis',plainText(summary) || (live ? 'Programme information is not available for this channel.' : 'No synopsis is available for this title.')));
    if (live && programme?.StartDate && programme.EndDate) body.append(this.liveProgress(programme));
    if (this.target && !live && progress(this.target) > 0 && progress(this.target) < 100) body.append(this.resumeProgress(this.target));
    const actions = el('div',`tvl-actions${movie ? ' tvl-actions-movie' : ''}`);
    const play = button(this.playLabel(), 'play', 'tvl-primary', () => { if(this.target) void this.play(this.target); });
    play.dataset.focusId = 'play'; play.disabled = !this.target || !playable(this.target);
    actions.append(play);
    if (movie) {
      const trailer=button('Trailer','trailer','tvl-trailer',()=>void this.playTrailer());
      trailer.setAttribute('aria-label','Watch trailer');trailer.dataset.focusId='trailer';
      actions.append(trailer);
    }
    if (this.item.Type === 'Series') {
      const episodes = button('Episodes & seasons','episodes','', () => this.open('episodes'));
      episodes.dataset.focusId = 'episodes'; actions.append(episodes);
    }
    if (live) {
      const guide=button('Channels & guide','live','',this.options.openGuide);
      guide.dataset.focusId='guide';actions.append(guide);
    }
    else {
      const similar = button('More like this','grid',movie ? 'tvl-round-label' : '',() => this.open('similar'));
      similar.dataset.focusId = 'similar'; actions.append(similar);
    }
    const favorite = button(this.item.UserData?.IsFavorite ? 'In favourites' : 'Add to favourites', 'heart', movie ? 'tvl-icon-button' : 'tvl-favorite', () => void this.toggleFavorite());
    favorite.setAttribute('aria-label',this.item.UserData?.IsFavorite ? 'Remove from favourites' : 'Add to favourites');
    favorite.setAttribute('aria-pressed',String(!!this.item.UserData?.IsFavorite));
    favorite.dataset.favorite = ''; favorite.dataset.focusId = 'favorite'; actions.append(favorite);
    body.append(actions);
    if (!live && !movie && this.item.Genres?.length) body.append(el('p','tvl-genre-line',this.item.Genres.slice(0,3).join('  ·  ')));
    hero.append(body);
    if (movie) {
      this.content.append(hero, this.filmDetails());
    } else {
      const footer = el('footer','tvl-footer');
      footer.append(el('span','tvl-footer-kind',live ? 'YOUR LIVE CHANNELS' : 'DISCOVER MORE'), el('span','tvl-remote-hint','↑ ↓ Navigate    OK Select    Back Return'));
      this.content.append(hero, footer);
    }
    if (!live) {
      const collections = el('section','tvl-collections');
      collections.setAttribute('aria-label','Collections');
      // An empty placeholder avoids advertising membership before the server replies.
      this.content.append(collections);
      void this.fillCollections(collections);
      const more = el('section','tvl-movie-recommendations');
      more.setAttribute('aria-label','More like this');
      more.append(el('h2','tvl-section-title','More like this'));
      this.content.append(more);
      void this.fillRecommendations(more, false);
    }
    this.focusFirst(this.restoreId); this.restoreId = '';
  }
  private filmDetails(): HTMLElement {
    const details = el('section','tvl-film-details');
    const left = el('div','tvl-film-description');
    if (this.item.Taglines?.[0]) left.append(el('p','tvl-tagline',this.item.Taglines[0]));
    left.append(el('p','',plainText(this.item.Overview) || 'No synopsis available.'));
    const right = el('dl','tvl-facts');
    const people = (this.item.People || []).filter(p=>p.Type === 'Actor').slice(0,4).map(p=>p.Name).filter(Boolean);
    const directors = (this.item.People || []).filter(p=>p.Type === 'Director').map(p=>p.Name).filter(Boolean);
    for (const [label,value] of [['Cast', people.join(', ')], ['Director',directors.join(', ')], ['Genres',(this.item.Genres || []).join(', ')]]) {
      if (!value) continue;
      const row = el('div'); row.append(el('dt','',`${label}:`),el('dd','',value)); right.append(row);
    }
    details.append(left,right); return details;
  }
  private resumeProgress(item: Item): HTMLElement {
    const wrap = el('div','tvl-resume');
    const bar = el('div','tvl-progress'); const fill = el('span'); fill.style.width = `${progress(item)}%`; bar.append(fill);
    const remaining = runtime(Math.max(0,(item.RunTimeTicks || 0)-(item.UserData?.PlaybackPositionTicks || 0)));
    wrap.append(bar,el('span','',`${remaining} remaining`)); return wrap;
  }
  private liveProgress(item: Item): HTMLElement {
    const wrap = el('div','tvl-live-progress');
    const bar = el('div','tvl-progress');const fill = el('span');fill.dataset.liveProgress='';fill.style.width=`${programmeProgress(item)}%`;bar.append(fill);
    const label = el('div','tvl-live-times');label.append(el('span','',time(item.StartDate)),el('span','',time(item.EndDate)));
    wrap.append(bar,label);return wrap;
  }
  private playLabel(): string {
    if (this.item.Type === 'TvChannel') return 'Watch live';
    if (!this.target) return 'No episodes available';
    const resume = (this.target.UserData?.PlaybackPositionTicks || 0) > 0 && !this.target.UserData?.Played;
    const code = this.item.Type === 'Series' ? episodeCode(this.target) : '';
    return `${resume ? 'Resume' : 'Play'}${code ? ` ${code}` : ''}`;
  }
  private open(pane: Pane): void {
    this.restoreId = (document.activeElement as HTMLElement)?.dataset.focusId || '';
    this.pane = pane;this.render();
  }
  back(): void {
    if (this.pane !== 'overview') {this.pane='overview';this.render();}
    else this.options.back();
  }
  private async fetchEpisodes(season: Item): Promise<Item[]> {
    const cached = this.episodes.get(season.Id);
    if (cached) return cached;
    const items = await this.api.getEpisodes(this.item.Id, season.Id);
    if (!this.disposed) this.episodes.set(season.Id,items);
    return items;
  }
  private moveBetweenSeasons(direction: string): boolean {
    if (this.pane !== 'episodes' || !this.selectedSeason || !['up','down'].includes(direction)) return false;
    const cards = Array.from(this.element.querySelectorAll<HTMLElement>('.tvl-episode'));
    const current = document.activeElement as HTMLElement;
    const forwards = direction === 'down';
    if (!cards.length || current !== cards[forwards ? cards.length - 1 : 0]) return false;
    const seasonIndex = this.seasons.findIndex(season => season.Id === this.selectedSeason?.Id);
    const next = this.seasons[seasonIndex + (forwards ? 1 : -1)];
    if (next) {
      this.selectedSeason = next;
      void this.updateEpisodes(forwards ? 'first' : 'last');
    }
    // At the outer edges, keep the episode focused instead of wrapping seasons.
    return true;
  }
  private async renderEpisodes(): Promise<void> {
    const layout = el('main','tvl-browser');
    const sidebar = el('aside','tvl-sidebar');
    sidebar.append(el('div','tvl-eyebrow','EXPLORE THE SERIES'), this.title(true), this.meta());
    const seasons = el('nav','tvl-seasons'); seasons.setAttribute('aria-label','Seasons');
    for (const season of this.seasons) {
      const node = button(seasonName(season), '', 'tvl-season', () => { this.selectedSeason=season; void this.updateEpisodes(); });
      node.dataset.season = season.Id;
      node.setAttribute('aria-pressed',String(season.Id === this.selectedSeason?.Id));
      node.append(el('span','tvl-season-count',season.ChildCount != null ? String(season.ChildCount) : ''),icon('chevron'));
      seasons.append(node);
    }
    sidebar.append(seasons);
    const right = el('section','tvl-browser-main'); right.id='tvl-episodes-area';
    layout.append(sidebar,right);this.content.append(layout);
    if (!this.seasons.length) {
      right.append(this.empty('No seasons available','Seasons will appear here when they are available in your library.'));
      this.focusFirst(); return;
    }
    void this.updateEpisodes();
    const active = seasons.querySelector<HTMLElement>('[aria-pressed="true"]'); active?.focus({preventScroll:true});
  }
  private async updateEpisodes(focusEdge?: 'first' | 'last'): Promise<void> {
    if (!this.selectedSeason) return;
    const season = this.selectedSeason;
    const revision = ++this.loadingRevision;
    const area = this.element.querySelector<HTMLElement>('#tvl-episodes-area'); if (!area) return;
    this.element.querySelectorAll<HTMLElement>('[data-season]').forEach(node => node.setAttribute('aria-pressed',String(node.dataset.season===season.Id)));
    const anchor = focusEdge ? Array.from(this.element.querySelectorAll<HTMLElement>('[data-season]')).find(node => node.dataset.season === season.Id) : undefined;
    // Keep focus on an existing control while the old episode list is replaced.
    // Only move it into the new list if the user has not navigated elsewhere.
    anchor?.focus({preventScroll:true});
    const heading = el('div','tvl-browser-heading');heading.append(el('h2','',seasonName(season)),el('span','tvl-browser-subtitle','SELECT AN EPISODE'));
    area.setAttribute('aria-busy','true');
    replace(area,heading,el('div','tvl-loading','Loading episodes…'));
    try {
      const items = await this.fetchEpisodes(season);
      if (this.disposed || revision !== this.loadingRevision || this.pane !== 'episodes') return;
      const list = el('div','tvl-episode-list');list.setAttribute('aria-label',`${seasonName(season)} episodes`);
      if (!items.length) list.append(this.empty('No episodes available','This season has no playable episodes yet.'));
      for (const episode of items) {
        const card = el('button','tvl-episode'); card.type='button';card.dataset.episode=episode.Id;
        card.setAttribute('aria-label',`${episodeCode(episode)} ${episode.Name}${episode.UserData?.Played ? ', watched' : ''}`);
        const thumb = picture(this.api.image(episode,'thumb'),'tvl-episode-thumb');
        const overlay = el('span','tvl-thumb-play');overlay.append(icon('play'));thumb.append(overlay);
        thumb.append(el('span','tvl-episode-number',episodeCode(episode)));
        if (progress(episode)>0) {const bar=el('span','tvl-thumb-progress');bar.style.width=`${progress(episode)}%`;thumb.append(bar);}
        const copy=el('div','tvl-episode-copy');
        const title=el('div','tvl-episode-title');title.append(el('h3','',episode.Name),el('span','',runtime(episode.RunTimeTicks)));
        copy.append(title,el('p','',plainText(episode.Overview)||'No synopsis available.'));
        if (episode.UserData?.Played) {const watched=el('span','tvl-watched','Watched');watched.prepend(icon('check'));copy.append(watched);}
        else if (episode.UserData?.PlaybackPositionTicks) copy.append(el('span','tvl-continue','Continue watching'));
        card.append(thumb,copy);card.addEventListener('click',()=>void this.play(episode));list.append(card);
      }
      replace(area,heading,list);
      area.setAttribute('aria-busy','false');
      if (anchor && document.activeElement === anchor) {
        const cards = list.querySelectorAll<HTMLElement>('.tvl-episode');
        const target = cards[focusEdge === 'last' ? cards.length - 1 : 0];
        target?.focus({preventScroll:true});
        target?.scrollIntoView({block:'nearest',inline:'nearest'});
        if (!target) this.announce(`${seasonName(season)} has no episodes available.`);
      }
    } catch {
      if (this.disposed || revision !== this.loadingRevision || this.pane !== 'episodes') return;
      replace(area,heading,this.empty('Episodes could not be loaded','Check your connection and try again.',()=>void this.updateEpisodes(focusEdge)));
      area.setAttribute('aria-busy','false');
      if (anchor && document.activeElement === anchor) area.querySelector<HTMLElement>('button')?.focus({preventScroll:true});
    }
  }
  private async renderSimilar(): Promise<void> {
    const main=el('main','tvl-similar');main.append(el('div','tvl-eyebrow',`BECAUSE YOU WATCH ${this.item.Name}`),el('h1','tvl-section-title','More like this'));
    this.content.append(main);await this.fillRecommendations(main,true);
  }
  private async fillCollections(container: HTMLElement): Promise<void> {
    const revision = this.revision;
    container.setAttribute('aria-busy','true');
    try {
      const collections = await this.api.getCollections(this.item.Id);
      if (this.disposed || revision !== this.revision) return;
      const restoreFocus = container.contains(document.activeElement);
      container.removeAttribute('aria-busy');
      if (!collections.length) { container.remove(); if (restoreFocus) this.focusFirst(); return; }
      const grid = el('div','tvl-film-grid');
      for (const collection of collections) {
        const card = el('button','tvl-film-card tvl-collection-card');
        card.type = 'button';
        card.dataset.focusId = `collection-${collection.Id}`;
        card.setAttribute('aria-label',`Open collection: ${collection.Name}`);
        const art = picture(this.api.image(collection,'thumb'),'tvl-film-art');
        const copy = el('div','tvl-film-copy');
        copy.append(el('h3','',collection.Name),el('span','tvl-collection-link','View collection →'));
        card.append(art,copy);
        card.addEventListener('click',()=>this.options.navigate(collection.Id));
        grid.append(card);
      }
      replace(container,el('h2','tvl-section-title','Collections'),grid);
      if (restoreFocus) this.focusFirst('',grid);
    } catch {
      if (this.disposed || revision !== this.revision) return;
      const restoreFocus = container.contains(document.activeElement);
      container.removeAttribute('aria-busy');
      const retry = button('Try again','','',()=>{
        if (container.getAttribute('aria-busy') === 'true') return;
        retry.setAttribute('aria-busy','true');
        void this.fillCollections(container);
      });
      replace(container,el('h2','tvl-section-title','Collections'),el('p','tvl-collections-message','Collections could not be loaded.'),retry);
      if (restoreFocus) retry.focus({preventScroll:true});
    }
  }
  private async fillRecommendations(container: HTMLElement, focus: boolean): Promise<void> {
    const rev=this.revision;const loading=el('div','tvl-loading','Finding something you’ll love…');container.append(loading);
    try {
      const items=await this.api.getSimilar(this.item.Id);
      if(this.disposed||rev!==this.revision)return;
      this.similar=items;loading.remove();
      const grid=el('div','tvl-film-grid');
      if(!items.length)grid.append(this.empty('A little more to discover','No similar titles are available in your library yet.'));
      for(const item of items){
        const card=el('button','tvl-film-card');card.type='button';
        const art=picture(this.api.image(item,'thumb'),'tvl-film-art');art.append(el('span','tvl-film-duration',runtime(item.RunTimeTicks)));
        const copy=el('div','tvl-film-copy');copy.append(el('h3','',item.Name));
        const meta=el('div','tvl-card-meta');if(item.ProductionYear)meta.append(el('span','',String(item.ProductionYear)));if(item.OfficialRating)meta.append(el('span','tvl-rating',item.OfficialRating));
        copy.append(meta,el('p','',plainText(item.Overview)||'View this title in your library.'));card.append(art,copy);
        card.addEventListener('click',()=>this.options.navigate(item.Id));grid.append(card);
      }
      container.append(grid);if(focus)this.focusFirst('',grid);
    }catch{
      if(this.disposed||rev!==this.revision)return;
      loading.remove();container.append(this.empty('Recommendations unavailable','You can still play this title.',()=>{container.querySelector('.tvl-empty')?.remove();void this.fillRecommendations(container,focus);}));
      if(focus)this.focusFirst();
    }
  }
  private async toggleFavorite(): Promise<void> {
    if(this.favoritePending)return;this.favoritePending=true;
    const value=!this.item.UserData?.IsFavorite;
    try{await this.api.setFavorite(this.item.Id,value);if(this.disposed)return;this.item.UserData={...this.item.UserData,IsFavorite:value};
      const node=this.element.querySelector<HTMLButtonElement>('[data-favorite]');
      if(node){node.setAttribute('aria-pressed',String(value));node.setAttribute('aria-label',value?'Remove from favourites':'Add to favourites');const label=node.querySelector('span');if(label)label.textContent=value?'In favourites':'Add to favourites';}
      this.announce(value?'Added to your favourites':'Removed from your favourites');
    }catch{this.announce('Could not update favourites. Please try again.');}finally{this.favoritePending=false;}
  }
  private async play(item: Item): Promise<void> {
    if(this.launching||!playable(item))return;
    await this.launch(
      ()=>this.api.play(item,item.Type==='TvChannel'||item.UserData?.Played ? 0 : item.UserData?.PlaybackPositionTicks||0,()=>!this.disposed),
      item.Type==='TvChannel'?'Tuning channel…':`Starting ${item.Name}…`
    );
  }
  private async playTrailer(): Promise<void> {
    if(this.item.Type!=='Movie'||this.launching)return;
    await this.launch(()=>this.api.playTrailer(this.item,()=>!this.disposed),`Starting trailer for ${this.item.Name}…`);
  }
  private async launch(request:()=>Promise<void>,pending:string): Promise<void> {
    this.launching=true;this.announce(pending);
    const focused=document.activeElement as HTMLButtonElement;
    focused?.setAttribute('aria-busy','true');
    const finish=(message:string)=>{if(this.disposed)return;this.launching=false;focused?.removeAttribute('aria-busy');this.announce(message);};
    try{
      await request();
      if(this.disposed)return;
      this.launchTimer=window.setTimeout(()=>finish('Playback has not started. Please try again.'),15_000);
    }catch(error){finish(error instanceof Error?error.message:'Could not start playback. Please try again.');}
  }
  private empty(title: string, description: string, retry?: () => void): HTMLElement {
    const node=el('div','tvl-empty');node.append(el('h2','',title),el('p','',description));
    if(retry)node.append(button('Try again','','',retry));return node;
  }
  private announce(message: string): void {this.status.textContent=message;}
  private focusFirst(id='',within:HTMLElement=this.element): void {
    const node=(id?Array.from(within.querySelectorAll<HTMLElement>('[data-focus-id]')).find(node=>node.dataset.focusId===id):null)
      ||within.querySelector<HTMLElement>('.tvl-primary:not(:disabled), .tvl-film-card, .tvl-season')||within.querySelector<HTMLElement>('button:not(:disabled)');
    node?.focus({preventScroll:true});
  }
  destroy(): void {this.disposed=true;this.loadingRevision++;this.revision++;this.removeRemote();window.clearTimeout(this.launchTimer);window.clearInterval(this.liveTimer);this.element.remove();}
}
