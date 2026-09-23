import type { Item, MediaApi, MovieQuery, SuggestionSection } from './types';
import { button, el, icon, picture, replace } from './dom';
import { attachRemote } from './remote';

export type MovieTab = 'movies' | 'suggestions' | 'favorites' | 'genres';
export type MovieBrowseState = {
  tab: MovieTab;
  search: string;
  letter: string;
  genreId?: string;
  genreName?: string;
  /** Raw API pagination depth, including any items filtered by the adapter. */
  loadedCount: number;
  focusId?: string;
  scrollTop?: number;
};
type Options = {
  parentId?: string;
  initialTab?: MovieTab;
  back: () => void;
  navigate: (id: string) => void;
  openCollections: () => void;
  focusId?: string;
  state?: MovieBrowseState;
  onState?: (state: MovieBrowseState) => void;
};
const pageSize = 48;
const tabs: [MovieTab, string][] = [['movies', 'All movies'], ['suggestions', 'Suggestions'], ['favorites', 'Favourites'], ['genres', 'Genres']];

export class MoviesView {
  readonly element = el('section', 'tvl-root tvl-keyboard tvl-movies-view');
  private content = el('div', 'tvl-content');
  private hero = el('div', 'tvl-movies-hero');
  private navigation = el('nav', 'tvl-movies-tabs');
  private filters = el('div', 'tvl-movies-filters');
  private results = el('div', 'tvl-movies-results');
  private count = el('p', 'tvl-movies-count');
  private input = el('input', 'tvl-movies-search-input');
  private state: MovieBrowseState;
  private nextFocus = '';
  private initialScroll = 0;
  private restoring = false;
  private internalFocus = false;
  private focusRevision = 0;
  private items: Item[] = [];
  private total: number | null = null;
  private nextStart = 0;
  private hasMore = false;
  private loading = false;
  private disposed = false;
  private revision = 0;
  private removeRemote: () => void;

  constructor(private api: MediaApi, private options: Options) {
    this.state = { tab: options.initialTab || 'movies', search: '', letter: '', loadedCount: 0, ...options.state };
    this.nextFocus = options.focusId || this.state.focusId || '';
    this.initialScroll = this.state.scrollTop || 0;
    this.restoring = !!(options.state || options.focusId);
    this.element.id = 'tv-layout';
    this.element.dataset.pane = 'movies';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', 'Movies');
    const header = el('header', 'tvl-header');
    const back = button('Back', 'back', 'tvl-back', options.back);
    back.dataset.focusId = 'back';
    header.append(back);
    const heroCopy = el('div', 'tvl-movies-hero-copy');
    heroCopy.append(el('h1', 'tvl-movies-title', 'Movies'), this.count);
    this.hero.append(heroCopy);
    this.navigation.setAttribute('aria-label', 'Browse movies');
    this.count.setAttribute('aria-live', 'polite');
    this.content.append(header, this.hero, this.navigation, this.filters, this.results);
    this.element.append(this.content);
    this.renderControls();
    this.removeRemote = attachRemote(this.element, options.back);
    this.element.addEventListener('focusin', event => {
      if (this.internalFocus) return;
      const id = (event.target as HTMLElement).dataset.focusId;
      if (id) {
        this.focusRevision++;
        this.restoring = false; this.initialScroll = 0;
        this.state.focusId = id; this.save();
      }
    });
    this.content.addEventListener('scroll', () => { this.save(); }, { passive: true });
  }

  async load(): Promise<void> { await this.loadResults(); }

  private save(): void {
    if (!this.restoring) this.state.scrollTop = this.content.scrollTop;
    if (!this.disposed) this.options.onState?.({ ...this.state });
  }

  private change(next: Partial<MovieBrowseState>, focusId: string): void {
    this.state = { ...this.state, ...next, loadedCount: 0, scrollTop: 0, focusId: focusId || undefined };
    this.nextFocus = focusId;
    this.initialScroll = 0; this.restoring = false;
    this.content.scrollTop = 0;
    this.items = [];
    this.renderControls();
    this.focus(focusId);
    this.save();
    void this.loadResults();
  }

  private renderControls(): void {
    replace(this.navigation);
    for (const [tab, label] of tabs) {
      const control = button(label, '', 'tvl-movies-tab', () => {
        this.change({ tab, search: '', letter: '', genreId: undefined, genreName: undefined }, `tab:${tab}`);
      });
      control.dataset.focusId = `tab:${tab}`;
      control.dataset.movieTab = tab;
      control.setAttribute('aria-pressed', String(this.state.tab === tab));
      this.navigation.append(control);
    }
    const collections = button('Collections', 'grid', 'tvl-movies-tab tvl-movies-collections', this.options.openCollections);
    collections.dataset.focusId = 'collections';
    this.navigation.append(collections);
    const form = el('form', 'tvl-movies-search');
    form.setAttribute('role', 'search');
    this.input = el('input', 'tvl-movies-search-input');
    this.input.type = 'search'; this.input.tabIndex = 0;
    this.input.placeholder = 'Search movies'; this.input.value = this.state.search;
    this.input.autocomplete = 'off'; this.input.dataset.focusId = 'search';
    this.input.setAttribute('aria-label', 'Search movies');
    const submit = button('Search', '', 'tvl-movies-search-submit', () => {});
    submit.type = 'submit'; submit.dataset.focusId = 'search-submit';
    form.append(this.input, submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const tab = this.state.tab === 'suggestions' || (this.state.tab === 'genres' && !this.state.genreId) ? 'movies' : this.state.tab;
      this.change({ tab, search: this.input.value.trim(), letter: '' }, 'search');
    });
    if (this.state.search) {
      const clear = button('Clear search', 'close', 'tvl-movies-clear', () => this.change({ search: '' }, 'search'));
      clear.dataset.focusId = 'clear-search'; form.append(clear);
    }
    const controls: HTMLElement[] = [form];
    if (this.state.tab === 'movies' || this.state.tab === 'favorites' || this.state.genreId) {
      const alphabet = el('nav', 'tvl-movies-alphabet');
      alphabet.setAttribute('aria-label', 'Browse by title');
      for (const letter of ['', '#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']) {
        const control = button(letter || 'All', '', 'tvl-movies-letter', () => this.change({ letter }, `letter:${letter || 'all'}`));
        control.dataset.focusId = `letter:${letter || 'all'}`;
        control.dataset.movieLetter = letter;
        control.setAttribute('aria-pressed', String(this.state.letter === letter));
        if (letter === '#') control.setAttribute('aria-label', '# — numbers and symbols');
        alphabet.append(control);
      }
      controls.push(alphabet);
    }
    replace(this.filters, ...controls);
  }

  private query(startIndex: number): MovieQuery {
    return { parentId: this.options.parentId, search: this.state.search || undefined,
      letter: this.state.letter || undefined, genreId: this.state.tab === 'genres' ? this.state.genreId : undefined,
      favorite: this.state.tab === 'favorites' || undefined, startIndex, limit: pageSize };
  }

  private async loadResults(append = false): Promise<void> {
    if (this.disposed || (append && this.loading)) return;
    const revision = ++this.revision;
    const current = () => !this.disposed && revision === this.revision;
    this.loading = true;
    const requestedFocus = this.nextFocus;
    const focusRevision = this.focusRevision;
    this.nextFocus = '';
    const firstNew = this.items.length;
    this.results.setAttribute('aria-busy', 'true');
    if (!append) {
      this.count.textContent = '';
      const loading = el('p', 'tvl-loading', this.state.tab === 'suggestions' ? 'Finding something to watch…' : 'Loading your movies…');
      loading.setAttribute('role', 'status');
      replace(this.results, loading);
      if (!this.element.contains(document.activeElement)) this.focus(`tab:${this.state.tab}`, false, false);
    } else this.results.querySelector<HTMLButtonElement>('[data-focus-id="show-more"]')?.setAttribute('aria-busy', 'true');
    try {
      if (this.state.tab === 'suggestions') {
        const sections = await this.api.getMovieSuggestions(this.options.parentId);
        if (!current()) return;
        this.renderSuggestions(sections);
      } else if (this.state.tab === 'genres' && !this.state.genreId) {
        const genres = await this.api.getMovieGenres(this.options.parentId);
        if (!current()) return;
        this.renderGenres(genres);
      } else {
        let offset = append ? this.nextStart : 0;
        const desired = append ? offset + pageSize : Math.max(pageSize, this.state.loadedCount || 0);
        const unique = new Map((append ? this.items : []).map(item => [item.Id, item]));
        let more = true;
        let total: number | null = null;
        do {
          const page = await this.api.getMovies(this.query(offset));
          if (!current()) return;
          for (const item of page.items) unique.set(item.Id, item);
          total = typeof page.total === 'number' && Number.isFinite(page.total) ? page.total : null;
          const next = page.nextStartIndex;
          more = next > offset && (total !== null ? next < total : next - offset >= pageSize);
          offset = next;
        } while (more && offset < desired);
        this.items = [...unique.values()]; this.total = total;
        this.nextStart = offset; this.hasMore = more; this.state.loadedCount = offset;
        this.count.textContent = total === null ? '' : `${total} ${total === 1 ? 'movie' : 'movies'}`;
        this.renderMovies();
      }
      if (!current()) return;
      this.results.removeAttribute('aria-busy'); this.loading = false;
      const target = append ? `movie:${this.items[firstNew]?.Id || ''}` : requestedFocus;
      if (focusRevision === this.focusRevision && (this.element.contains(document.activeElement) || document.activeElement === document.body)) {
        if (target) this.focus(target, true);
        else if (!this.state.focusId || this.state.focusId === `tab:${this.state.tab}`) this.focusFirstResult();
        if (this.restoring) this.content.scrollTop = this.initialScroll;
      }
      this.initialScroll = 0; this.restoring = false;
      this.save();
    } catch {
      if (!current()) return;
      this.loading = false; this.results.removeAttribute('aria-busy');
      const error = el('div', 'tvl-movies-empty');
      const retry = button('Try again', '', 'tvl-primary', () => { this.nextFocus = requestedFocus; void this.loadResults(append); });
      retry.dataset.focusId = 'retry';
      error.append(el('h2', '', 'Movies unavailable'), el('p', '', 'Check your connection and try again.'), retry);
      if (append) {
        this.results.querySelector('.tvl-movies-more')?.remove();
        this.results.querySelector('.tvl-movies-empty')?.remove();
        this.results.append(error);
      } else replace(this.results, error);
      this.restoring = false; this.initialScroll = 0;
      if (focusRevision === this.focusRevision && (this.element.contains(document.activeElement) || document.activeElement === document.body)) this.focus('retry');
    }
  }

  private renderMovies(): void {
    const heading = el('div', 'tvl-movies-section-heading');
    let label = this.state.tab === 'favorites' ? 'Your favourites' : this.state.genreName || 'All movies';
    if (this.state.search) label = `Results for “${this.state.search}”`;
    else if (this.state.letter) label += ` · ${this.state.letter}`;
    heading.append(el('h2', '', label));
    if (this.state.tab === 'genres' && this.state.genreId) {
      const all = button('All genres', 'back', 'tvl-movies-all-genres', () => this.change({ genreId: undefined, genreName: undefined, letter: '', search: '' }, 'tab:genres'));
      all.dataset.focusId = 'all-genres'; heading.append(all);
    }
    replace(this.results, heading);
    if (this.items.length) this.results.append(this.grid(this.items, label));
    else this.results.append(this.empty(this.state.tab === 'favorites' ? 'No favourites found' : 'No movies found',
      this.state.search || this.state.letter || this.state.genreId ? 'Try a different search or filter.' : this.state.tab === 'favorites' ? 'Your favourite movies will appear here.' : 'Movies in this library will appear here.'));
    if (this.hasMore) {
      const footer = el('div', 'tvl-movies-more');
      const more = button('Show more', '', 'tvl-primary', () => { void this.loadResults(true); });
      more.dataset.focusId = 'show-more'; footer.append(more); this.results.append(footer);
    }
    this.artwork(this.items[0]);
  }

  private renderSuggestions(sections: SuggestionSection[]): void {
    replace(this.results);
    let first: Item | undefined;
    for (const [index, section] of sections.entries()) {
      if (!section.items.length) continue;
      first ||= section.items[0];
      const group = el('section', 'tvl-movies-suggestion-section');
      group.setAttribute('aria-label', section.title);
      group.append(el('h2', 'tvl-movies-section-title', section.title), this.grid(section.items, section.title, `movie:section-${index}`));
      this.results.append(group);
    }
    if (!first) this.results.append(this.empty('No suggestions yet', 'Suggestions will appear as your library grows.'));
    this.artwork(first);
  }

  private renderGenres(genres: Item[]): void {
    this.count.textContent = `${genres.length} ${genres.length === 1 ? 'genre' : 'genres'}`;
    const grid = el('div', 'tvl-movies-genres');
    for (const genre of genres) {
      const card = button(genre.Name, 'chevron', 'tvl-movies-genre', () => this.change({ genreId: genre.Id, genreName: genre.Name, search: '', letter: '' }, ''));
      card.dataset.genreId = genre.Id; card.dataset.focusId = `genre:${genre.Id}`;
      grid.append(card);
    }
    replace(this.results, el('h2', 'tvl-movies-section-title', 'Browse genres'), genres.length ? grid : this.empty('No genres yet', 'Genres from your movie library will appear here.'));
    this.artwork();
  }

  private grid(items: Item[], label: string, focusPrefix = 'movie'): HTMLElement {
    const grid = el('div', 'tvl-movies-grid');
    grid.setAttribute('role', 'list'); grid.setAttribute('aria-label', label);
    for (const item of items) {
      const entry = el('div', 'tvl-movies-entry'); entry.setAttribute('role', 'listitem');
      const card = el('button', 'tvl-movies-card'); card.type = 'button';
      card.dataset.movieItem = item.Id; card.dataset.focusId = `${focusPrefix}:${item.Id}`;
      card.setAttribute('aria-label', item.Name);
      const art = picture(this.api.image(item, 'thumb'), 'tvl-movies-art');
      const placeholder = el('span', 'tvl-movies-placeholder'); placeholder.setAttribute('aria-hidden', 'true');
      placeholder.append(icon('grid')); art.append(placeholder);
      if (item.UserData?.IsFavorite) { const favorite = el('span', 'tvl-movies-favorite'); favorite.setAttribute('aria-label', 'Favourite'); favorite.append(icon('heart')); art.append(favorite); }
      const caption = el('div', 'tvl-movies-caption'); caption.append(el('h3', '', item.Name));
      const meta = [item.ProductionYear ? String(item.ProductionYear) : '', item.OfficialRating || ''].filter(Boolean);
      if (meta.length) caption.append(el('p', '', meta.join(' · ')));
      card.append(art, caption);
      card.addEventListener('click', () => { if (!this.disposed) { this.save(); this.options.navigate(item.Id); } });
      entry.append(card); grid.append(entry);
    }
    return grid;
  }

  private empty(title: string, message: string): HTMLElement {
    const empty = el('div', 'tvl-movies-empty'); empty.append(el('h2', '', title), el('p', '', message)); return empty;
  }

  private artwork(item?: Item): void {
    this.hero.querySelector('.tvl-movies-backdrop')?.remove();
    const art = picture(item ? this.api.image(item, 'backdrop') : null, 'tvl-movies-backdrop');
    art.setAttribute('aria-hidden', 'true'); this.hero.prepend(art);
  }

  private focus(id: string, fallback = false, record = true): void {
    const control = Array.from(this.element.querySelectorAll<HTMLElement>('[data-focus-id]')).find(node => node.dataset.focusId === id);
    if (control) {
      this.internalFocus = true;
      control.focus({ preventScroll: true });
      this.internalFocus = false;
      if (id.startsWith('movie:') || id.startsWith('genre:')) control.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (record) { this.state.focusId = id; this.save(); }
    }
    else if (fallback) this.focusFirstResult();
  }

  private focusFirstResult(): void {
    const result = this.results.querySelector<HTMLElement>('[data-movie-item], [data-genre-id]')
      || this.results.querySelector<HTMLElement>('button');
    const id = result?.dataset.focusId;
    if (id) this.focus(id);
  }

  destroy(): void {
    this.save(); this.disposed = true; this.revision++;
    this.removeRemote(); this.element.remove();
  }
}
