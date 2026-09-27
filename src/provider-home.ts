import { button, el, picture, replace } from './dom';
import { attachRemote } from './remote';
import type { Item, MediaApi } from './types';
import { providerAppearance, providerLogo } from './provider-appearance';
import { createProviderHomesStore } from './provider-settings-store';
import type { ProviderHomeConfig, ProviderHomesSettings, ProviderRow, ProviderId } from './provider-settings';
import { ProviderData, type ProviderRowResult } from './provider-data';
import { homeRowCard } from './home-row-card';
import { plainText } from './utils';

export function providerHomeRow(settings: ProviderHomesSettings, navigate: (id: ProviderId) => void): HTMLElement | null {
  const providers = settings.providers.filter(provider => provider.enabled);
  if (!settings.enabled || !providers.length) return null;
  const title = settings.title.trim() || 'Streaming services';
  const section = el('section', 'verticalSection tvl-home-provider-row');
  section.style.setProperty('--provider-tile-scale', String(settings.tileScale / 100));
  section.dataset.homeRow = 'provider-homes:brands'; section.setAttribute('aria-label', title);
  section.append(el('h2', 'tvl-home-row-title', title));
  const cards = el('div', 'tvl-home-row-cards tvl-provider-tiles focuscontainer-x'); cards.setAttribute('role', 'list');
  for (const provider of providers) {
    const brand = providerAppearance(provider);
    const entry = el('div', 'tvl-home-row-entry'); entry.setAttribute('role', 'listitem');
    const tile = el('button', 'tvl-provider-tile'); tile.type = 'button'; tile.setAttribute('aria-label', brand.name);
    tile.dataset.focusId = `provider:${provider.id}`; tile.dataset.provider = provider.id;
    tile.style.setProperty('--provider-accent', brand.accent);
    const mark = el('span', 'tvl-provider-tile-mark');
    mark.append(providerLogo(provider)); tile.append(mark);
    if (settings.showNames) tile.append(el('span', 'tvl-provider-tile-name', brand.name));
    tile.addEventListener('click', () => navigate(provider.id)); entry.append(tile); cards.append(entry);
  }
  section.append(cards); return section;
}

export type ProviderHomeState = { loadedCount: number; scrollTop: number };
type Options = {
  provider: ProviderId; rowId?: string; focusId?: string;
  state?: ProviderHomeState; onState?(state: ProviderHomeState): void;
  back(): void; navigate(id: string): void; openRow(id?: string): void;
};
type RowState = { config: ProviderRow; element: HTMLElement; cards: HTMLElement; status: HTMLElement;
  more: HTMLButtonElement; result?: ProviderRowResult; items: Item[]; busy: boolean; fingerprint: string; restoreCount: number; };

/** Provider pages retain native item routes/playback and only own this view's DOM. */
export class ProviderHomeView {
  readonly element = el('section', 'tvl-root tvl-provider-home');
  private content = el('main', 'tvl-provider-content');
  private header = el('header', 'tvl-provider-header');
  private rowsHost = el('div', 'tvl-provider-rows');
  private hero = el('section', 'tvl-provider-hero');
  private store;
  private data: ProviderData;
  private config?: ProviderHomeConfig;
  private states: RowState[] = [];
  private detach: () => void;
  private disposed = false;
  private generation = 0;
  private refreshTimer?: number;
  private initializing = true;
  private refreshing = false;
  private settingsReadAt = 0;
  private inputRevision = 0;
  private featureId?: string;
  private focusPending?: string;

  constructor(private api: MediaApi, private options: Options) {
    this.store = createProviderHomesStore(api); this.data = new ProviderData(api); this.focusPending = options.focusId;
    this.element.setAttribute('role', 'dialog'); this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', 'Streaming service'); this.element.dataset.provider = options.provider;
    const back = button('Back', 'back', 'tvl-back', options.back); back.dataset.focusId = 'provider-back';
    const identity = el('div', 'tvl-provider-identity');
    this.header.append(back, identity);
    this.content.append(this.hero, this.rowsHost);
    this.element.append(this.header, this.content);
    this.rowsHost.append(el('p', 'tvl-provider-message', 'Loading…'));
    window.addEventListener('keydown', this.onInput, true); window.addEventListener('command', this.onInput, true);
    document.addEventListener('pointerdown', this.onInput, true);
    this.detach = attachRemote(this.element, options.back, direction => this.moveRow(direction));
    back.focus({ preventScroll: true });
    window.addEventListener('focus', this.onVisible); document.addEventListener('visibilitychange', this.onVisible);
  }

  async load(): Promise<void> {
    const generation = ++this.generation;
    this.settingsReadAt = Date.now();
    let settings = this.store.cached;
    try { settings = await this.store.load(); } catch { /* Account-scoped cached preferences remain usable offline. */ }
    if (this.disposed || generation !== this.generation) return;
    await this.renderConfiguration(settings);
    if (this.disposed) return;
    this.initializing = false; this.scheduleRefresh();
  }

  private async renderConfiguration(settings: ProviderHomesSettings, preserve = false): Promise<void> {
    const generation = ++this.generation, inputRevision = this.inputRevision;
    const active = document.activeElement as HTMLElement | null;
    const focusId = preserve ? active && this.element.contains(active) ? active.dataset.focusId : undefined : this.focusPending;
    const scrollTop = preserve ? this.content.scrollTop : this.options.state?.scrollTop || 0;
    const previousRows = new Map(preserve ? this.states.map(row => [row.config.id, { count: row.items.length, scroll: row.cards.scrollLeft }]) : []);
    this.focusPending = focusId; this.featureId = undefined; this.states = [];
    this.header.querySelector('.tvl-provider-nav')?.remove();
    replace(this.hero); replace(this.rowsHost);
    this.config = settings.providers.find(provider => provider.id === this.options.provider && provider.enabled);
    if (!this.config) {
      this.hero.hidden = true; this.rowsHost.append(el('p', 'tvl-provider-message', 'This provider home is turned off.'));
      this.focusPending = undefined; this.findFocus('provider-back')?.focus({ preventScroll: true }); return;
    }
    const appearance = providerAppearance(this.config);
    this.element.setAttribute('aria-label', `${appearance.name} home`);
    this.element.style.setProperty('--provider-accent', appearance.accent);
    const label = el('div'); label.append(el('h1', '', appearance.name), el('p', '', 'Your library · United Kingdom'));
    replace(this.header.querySelector<HTMLElement>('.tvl-provider-identity')!, providerLogo(this.config, 'tvl-provider-header-logo'), label);
    const rows = this.config.rows.filter(row => row.enabled && (!this.options.rowId || row.id === this.options.rowId));
    this.element.classList.toggle('tvl-provider-library', !!this.options.rowId);
    this.hero.hidden = !this.config.hero || !!this.options.rowId;
    if (!this.hero.hidden) {
      replace(this.hero, el('p', 'tvl-provider-eyebrow', 'IN YOUR LIBRARY'), el('h2', 'tvl-provider-welcome', `Explore ${this.config.name}`));
    }
    const nav = el('nav', 'tvl-provider-nav'); nav.setAttribute('aria-label', 'Provider sections');
    const home = button('Home', '', '', () => this.options.openRow()); home.dataset.focusId = 'provider-home';
    home.setAttribute('aria-current', this.options.rowId ? 'false' : 'page'); nav.append(home);
    for (const row of this.config.rows.filter(row => row.enabled)) {
      const link = button(row.title || this.rowTitle(row), '', '', () => this.options.openRow(row.id));
      link.dataset.focusId = `provider-section:${row.id}`; link.setAttribute('aria-current', this.options.rowId === row.id ? 'page' : 'false'); nav.append(link);
    }
    this.header.append(nav); replace(this.rowsHost);
    this.states = rows.map(config => {
      const row = this.buildRow(config); row.restoreCount = previousRows.get(config.id)?.count || 0; return row;
    });
    if (!rows.length) this.rowsHost.append(el('p', 'tvl-provider-message', this.options.rowId ? 'This row is unavailable.' : 'No rows are enabled for this provider.'));
    this.focusInitial();
    await Promise.allSettled(this.states.map(row => this.loadRow(row)));
    if (this.disposed || generation !== this.generation) return;
    this.updateHero(this.states.find(row => row.items.length)?.items[0]);
    if (inputRevision === this.inputRevision) {
      for (const row of this.states) row.cards.scrollLeft = previousRows.get(row.config.id)?.scroll || 0;
      this.content.scrollTop = scrollTop;
      const target = focusId ? this.findFocus(focusId) : undefined;
      if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      else if (focusId || !this.element.contains(document.activeElement)) this.findFocus('provider-back')?.focus({ preventScroll: true });
    }
    this.focusPending = undefined;
  }

  private rowTitle(row: ProviderRow): string {
    return ({ movies: 'Films', shows: 'TV shows', 'trending-movies': 'Trending films', 'trending-shows': 'Trending TV shows', collection: 'Collection' })[row.source];
  }
  private buildRow(config: ProviderRow): RowState {
    const title = config.title.trim() || this.rowTitle(config);
    const element = el('section', 'tvl-provider-row'); element.dataset.providerRow = config.id; element.setAttribute('aria-label', title);
    const heading = el('div', 'tvl-provider-row-heading'); heading.append(el('h2', 'tvl-home-row-title', title));
    if (!this.options.rowId) {
      const all = button('View all', '', 'tvl-provider-view-all', () => this.options.openRow(config.id)); all.setAttribute('aria-label', `View all ${title}`);
      all.dataset.focusId = `provider-all:${config.id}`; heading.append(all);
    }
    const cards = el('div', this.options.rowId ? `tvl-provider-grid${config.ranked ? ' tvl-provider-ranked-grid' : ''}` : 'tvl-home-row-cards'); cards.setAttribute('role', 'list');
    const status = el('p', 'tvl-provider-row-status'); status.setAttribute('role', 'status'); status.textContent = 'Loading…';
    const more = button('Load more', '', 'tvl-provider-more', () => { void this.loadRow(state, true); }); more.hidden = true;
    more.dataset.focusId = `provider-more:${config.id}`;
    element.append(heading, cards, status, more); this.rowsHost.append(element);
    const state: RowState = { config, element, cards, status, more, items: [], busy: false, fingerprint: '', restoreCount: 0 }; return state;
  }
  private async loadRow(row: RowState, append = false): Promise<void> {
    if (row.busy || this.disposed) return;
    const generation = this.generation;
    const current = () => !this.disposed && generation === this.generation && this.states.includes(row);
    row.busy = true; row.more.disabled = true;
    try {
      const offset = append ? row.items.length : 0;
      // Preserve an expanded grid during background refreshes.
      const limit = this.options.rowId ? Math.max(60, append ? 60 : Math.max(row.items.length, row.restoreCount, this.options.state?.loadedCount || 0)) : 40;
      let result = await this.data.load(this.config!, row.config, offset, Math.min(100, limit));
      if (!append && this.options.rowId && limit > 100) {
        const items = [...result.items];
        while (current() && items.length < Math.min(limit, result.total)) {
          const next = await this.data.load(this.config!, row.config, items.length, Math.min(100, limit - items.length));
          if (!next.items.length) break; items.push(...next.items);
        }
        result = { ...result, items };
      }
      if (!current()) return;
      const items = Array.from(new Map((append ? [...row.items, ...result.items] : result.items).map(item => [item.Id, item])).values());
      const fingerprint = JSON.stringify(items);
      row.result = result;
      row.restoreCount = 0;
      if (fingerprint !== row.fingerprint) {
        const active = document.activeElement as HTMLElement;
        const focusId = row.cards.contains(active) ? active.dataset.focusId : undefined;
        const scroll = row.cards.scrollLeft;
        row.items = items; row.fingerprint = fingerprint; replace(row.cards);
        items.forEach((item, index) => {
          const entry = el('div', 'tvl-home-row-entry'); entry.setAttribute('role', 'listitem');
          const card = homeRowCard(this.api, item, row.config.ranked ? index + 1 : undefined, () => this.options.navigate(item.Id));
          card.dataset.focusId = `provider-item:${row.config.id}:${item.Id}`; entry.append(card); row.cards.append(entry);
        });
        row.cards.scrollLeft = scroll;
        if (focusId) this.findFocus(focusId)?.focus({ preventScroll: true });
        if (focusId && !this.findFocus(focusId)) row.element.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
      }
      row.more.hidden = !this.options.rowId || row.items.length >= result.total;
      const messages: string[] = [];
      if (result.status === 'refreshing' && !result.pending) messages.push('Refreshing UK availability…');
      if (result.pending) messages.push(`Checking UK availability: ${Math.max(0, result.totalToCheck - result.pending)} of ${result.totalToCheck} titles.`);
      if (result.status === 'unavailable' && !result.missingSource) messages.push(result.items.length ? 'Some availability could not be refreshed. Showing the last available results.' : 'UK availability is temporarily unavailable.');
      if (result.missingSource) messages.push(row.config.source === 'collection' || row.config.collectionId
        ? 'The selected collection is unavailable for this account.' : 'The trending collection is unavailable for this account.');
      if (result.missingIds) messages.push(`${result.missingIds} library titles need matching metadata before their availability can be checked.`);
      if (!messages.length && !row.items.length) messages.push('No matching titles in your library.');
      row.status.textContent = messages.join(' ');
      if (row === this.states[0]) this.updateHero(items[0]); this.focusInitial();
    } catch {
      if (!current()) return;
      row.status.textContent = row.items.length ? 'This row could not refresh. Your existing results are still shown.' : 'This row could not be loaded.';
      const retry = button('Retry', '', '', () => { void this.loadRow(row); }); retry.dataset.focusId = `provider-retry:${row.config.id}`; row.status.append(retry);
    } finally { row.busy = false; row.more.disabled = false; }
  }

  private updateHero(item?: Item): void {
    if (!item || this.hero.hidden || this.featureId) return;
    this.featureId = item.Id;
    const backdrop = picture(this.api.image(item, 'backdrop'), 'tvl-provider-feature-backdrop');
    const copy = el('div', 'tvl-provider-feature-copy');
    copy.append(el('p', 'tvl-provider-eyebrow', `${this.config!.name.toLocaleUpperCase()} · IN YOUR LIBRARY`), el('h2', 'tvl-provider-feature-title', item.Name));
    if (item.Overview) copy.append(el('p', 'tvl-provider-feature-description', plainText(item.Overview)));
    const details = button('Details', 'info', 'tvl-primary', () => this.options.navigate(item.Id)); details.dataset.focusId = 'provider-feature'; copy.append(details);
    replace(this.hero, backdrop, copy);
  }
  private findFocus(id: string): HTMLElement | undefined {
    return Array.from(this.element.querySelectorAll<HTMLElement>('[data-focus-id]'))
      .find(node => node.dataset.focusId === id && !node.closest('[hidden]') && !node.matches(':disabled'));
  }
  private focusInitial(): void {
    if (this.focusPending) {
      const target = this.findFocus(this.focusPending);
      if (target) { this.focusPending = undefined; target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    } else if (!this.element.contains(document.activeElement) && document.activeElement === document.body) this.header.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }
  private moveRow(direction: string): boolean {
    if (this.options.rowId || !['left', 'right'].includes(direction)) return false;
    const active = document.activeElement as HTMLElement;
    const row = this.states.find(row => row.cards.contains(active));
    if (!row) return false;
    const cards = Array.from(row.cards.querySelectorAll<HTMLButtonElement>('button'));
    const next = cards[cards.indexOf(active as HTMLButtonElement) + (direction === 'right' ? 1 : -1)];
    next?.focus({ preventScroll: true }); next?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return true;
  }
  private scheduleRefresh(): void {
    window.clearTimeout(this.refreshTimer);
    const pending = this.states.some(row => row.result?.pending || row.result?.status === 'refreshing');
    this.refreshTimer = window.setTimeout(() => { void this.refreshRows(); }, pending ? 5_000 : 60_000);
  }
  private async refreshConfiguration(force: boolean): Promise<boolean> {
    if (!force && Date.now() - this.settingsReadAt < 60_000) return false;
    this.settingsReadAt = Date.now();
    try {
      const settings = await this.store.load();
      if (this.disposed) return false;
      const config = settings.providers.find(provider => provider.id === this.options.provider && provider.enabled);
      if (JSON.stringify(config) === JSON.stringify(this.config)) return false;
      // A previous row may still be loading when another device changes its
      // source. Invalidate that read before rebuilding this provider only.
      this.data.invalidate(); await this.renderConfiguration(settings, true); return true;
    } catch { return false; /* Keep the current layout and focus during sync failures. */ }
  }
  private async refreshRows(forceSettings = false): Promise<void> {
    if (this.disposed || this.initializing || this.refreshing) return;
    if (document.visibilityState === 'hidden') { this.scheduleRefresh(); return; }
    this.refreshing = true;
    try {
      const rebuilt = await this.refreshConfiguration(forceSettings);
      if (!this.disposed && !rebuilt) await Promise.allSettled(this.states.map(row => this.loadRow(row)));
    } finally { this.refreshing = false; if (!this.disposed) this.scheduleRefresh(); }
  }
  private onInput = (): void => { this.inputRevision++; this.focusPending = undefined; };
  private onVisible = (): void => {
    if (!this.disposed && !this.initializing && !this.refreshing && document.visibilityState !== 'hidden') {
      // Reuse an in-flight read when browser focus returns during initial load.
      // Invalidating it would turn a valid response into a stale-request error.
      if (!this.states.some(row => row.busy)) this.data.invalidate();
      void this.refreshRows(true);
    }
  };
  destroy(): void {
    this.options.onState?.({ loadedCount: this.options.rowId ? this.states[0]?.items.length || 60 : 40, scrollTop: this.content.scrollTop });
    this.disposed = true; this.generation++; this.detach(); this.store.destroy(); this.data.destroy(); this.element.remove();
    window.clearTimeout(this.refreshTimer); window.removeEventListener('focus', this.onVisible); document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('keydown', this.onInput, true); window.removeEventListener('command', this.onInput, true);
    document.removeEventListener('pointerdown', this.onInput, true);
  }
}
