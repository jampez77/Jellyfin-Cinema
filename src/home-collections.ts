import type { Item, MediaApi } from './types';
import { button, el, picture, replace } from './dom';
import { emptyHomeCollections, homeCollectionKey, parseHomeCollections, rankImage, orderHomeItems, type HomeCollectionRow } from './home-collection-settings';
import { nativeHomeRows, rememberHomeRows } from './home-row-placement';

/** Insert owned rows between native Home rows without moving or rebuilding them. */
export class HomeCollections {
  private root = el('div', 'tvl-home-collections');
  private sections: { row: HomeCollectionRow; element: HTMLElement }[] = [];
  private settings = emptyHomeCollections();
  private key: string;
  private observer: MutationObserver;
  private disposed = false;
  private revision = 0;
  private inputRevision = 0;

  constructor(private api: MediaApi, private navigate: (id: string) => void, private restoreFocus?: string) {
    this.key = homeCollectionKey(api.serverId || location.origin, api.userId || (window.TvItemLayoutDemo ? 'demo' : 'anonymous'));
    try { this.settings = parseHomeCollections(JSON.parse(localStorage.getItem(this.key) || 'null')); } catch { /* Use defaults. */ }
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('command', this.onCommand, true);
    window.addEventListener('pointerdown', this.onPointer, true);
    this.observer = new MutationObserver(() => this.attach());
    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    this.attach(); void this.render();
  }

  private attach(): void {
    if (this.disposed) return;
    const host = document.querySelector<HTMLElement>('#indexPage #homeTab, #homeTab');
    if (!host) return;
    if (this.root.parentElement !== host) host.append(this.root);
    const anchors = nativeHomeRows(host);
    rememberHomeRows(this.key, anchors);
    // Process backwards so rows that share an insertion point keep their order.
    const nextAt = new Map<HTMLElement, HTMLElement>();
    for (const { row, element } of this.sections.slice().reverse()) {
      const anchor = row.placement === 'start' ? anchors[0] : anchors.find(anchor => anchor.key === row.placement);
      const point = anchor?.element || this.root;
      const target = nextAt.get(point) || anchor?.element;
      const parent = target?.parentElement || this.root;
      if (target) {
        if (element.parentElement !== parent || element.nextElementSibling !== target) parent.insertBefore(element, target);
      } else if (element.parentElement !== parent || element !== parent.lastElementChild) parent.append(element);
      nextAt.set(point, element);
    }
  }

  private focus(node?: HTMLElement): void {
    node?.focus({ preventScroll: true }); node?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  private owns(node: Element | null): boolean { return !!node && this.sections.some(section => section.element.contains(node)); }
  private move(direction: string): boolean {
    const active = document.activeElement as HTMLElement;
    const host = this.root.parentElement;
    if (!host?.contains(active) || active.matches('input,textarea,select') || active.closest('.ec-root')) return false;
    const controls = (group: HTMLElement) => Array.from(group.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]'))
      .filter(node => !node.closest('.hide,[hidden]') && node.getClientRects().length > 0);
    const groups = Array.from(host.querySelectorAll<HTMLElement>('.focuscontainer-x, .ec-root'))
      .filter(group => !group.querySelector('.focuscontainer-x') && controls(group).length > 0);
    const groupIndex = groups.findIndex(group => controls(group).includes(active));
    if (groupIndex < 0) return false;
    const current = controls(groups[groupIndex]), index = current.indexOf(active);
    if (direction === 'left' || direction === 'right') {
      if (!this.owns(active)) return false;
      this.focus(current[index + (direction === 'right' ? 1 : -1)]); return true;
    }
    const next = groups[groupIndex + (direction === 'down' ? 1 : -1)];
    if (!this.owns(active) && !this.owns(next)) return false;
    if (next) this.focus(controls(next)[Math.min(index, controls(next).length - 1)]);
    return !!next;
  }
  private onKey = (event: KeyboardEvent): void => {
    this.inputRevision++;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const direction: Record<string, string> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (direction[event.key] && this.move(direction[event.key])) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  private onCommand = (event: Event): void => {
    this.inputRevision++;
    const command = (event as CustomEvent).detail?.command?.toLowerCase();
    if (['left', 'right', 'up', 'down'].includes(command) && this.move(command)) { event.preventDefault(); event.stopImmediatePropagation(); }
    else if (this.owns(document.activeElement) && ['select', 'enter', 'ok'].includes(command)) {
      event.preventDefault(); event.stopImmediatePropagation(); (document.activeElement as HTMLElement).click();
    }
  };
  private onPointer = (): void => { this.inputRevision++; };
  private current(revision: number): boolean { return !this.disposed && revision === this.revision; }
  private async render(): Promise<void> {
    const revision = ++this.revision;
    const inputRevision = this.inputRevision;
    this.sections.forEach(section => section.element.remove()); this.sections = [];
    if (!this.settings.rows.length) { replace(this.root); return; }
    replace(this.root, el('p', 'tvl-home-row-status', 'Loading your collection rows…'));
    try {
      const available = new Map((await this.api.getCollectionList()).map(item => [item.Id, item]));
      if (!this.current(revision)) return;
      const rendered = await Promise.all(this.settings.rows.map(async row => ({ row, element: await this.section(row, available, revision) })));
      if (!this.current(revision)) return;
      replace(this.root); this.sections = rendered; this.attach();
      if (this.restoreFocus && inputRevision === this.inputRevision) {
        const target = this.sections.flatMap(section => Array.from(section.element.querySelectorAll<HTMLElement>('[data-focus-id]'))).find(node => node.dataset.focusId === this.restoreFocus);
        this.restoreFocus = undefined; this.focus(target);
      }
    } catch {
      if (!this.current(revision)) return;
      const error = el('div', 'tvl-home-row-status'); error.setAttribute('role', 'status');
      error.append(el('p', '', 'Your collection rows could not be loaded.'), button('Retry collection rows', '', '', () => { void this.render(); }));
      replace(this.root, error);
    }
  }

  private async section(row: HomeCollectionRow, available: Map<string, Item>, revision: number): Promise<HTMLElement> {
    const chosen = row.collectionIds.map(id => available.get(id)).filter((item): item is Item => !!item);
    const title = row.title || (row.kind === 'collections' ? 'Collections' : chosen[0]?.Name || 'Collection');
    const section = el('section', 'tvl-home-collection-row');section.dataset.homeRow = row.id;
    section.setAttribute('aria-label', title);section.append(el('h2', 'tvl-home-row-title', title));
    const cards = el('div', 'tvl-home-row-cards focuscontainer-x');cards.setAttribute('role', 'list');section.append(cards);
    if (!chosen.length) { cards.append(el('p', 'tvl-home-row-status', 'No accessible collections selected. Choose a collection from Customize collection rows on the Collections page.'));return section; }
    try {
      const items = row.kind === 'items' ? orderHomeItems(await this.api.getCollectionItems(chosen[0].Id), row) : chosen;
      if (!this.current(revision)) return section;
      for (const [index, item] of items.slice(0, 60).entries()) {
        const entry = el('div', 'tvl-home-row-entry');entry.setAttribute('role', 'listitem');
        const card = el('button', `tvl-home-row-card${row.ranked ? ' tvl-home-ranked' : ''}`);card.type = 'button';
        card.dataset.focusId = `home:${row.id}:${item.Id}`;card.dataset.itemId = item.Id;
        card.setAttribute('aria-label', row.ranked ? `Rank ${index + 1}: ${item.Name}` : item.Name);
        if (row.ranked) { const rank = el('img', 'tvl-home-rank');rank.src = rankImage(index + 1);rank.alt = '';rank.setAttribute('aria-hidden', 'true');card.append(rank); }
        const cover = el('div', 'tvl-home-row-cover');
        cover.append(picture(this.api.image(item, 'poster'), 'tvl-home-row-art'), el('span', 'tvl-home-row-caption', item.Name));
        card.append(cover);card.addEventListener('click', () => { if (!this.disposed) this.navigate(item.Id); });
        entry.append(card);cards.append(entry);
      }
      if (!items.length) cards.append(el('p', 'tvl-home-row-status', 'This collection is empty.'));
      if (row.kind === 'items' && items.length > 60) cards.append(button('View full collection', 'grid', '', () => this.navigate(chosen[0].Id)));
    } catch {
      cards.append(el('p', 'tvl-home-row-status', 'This collection could not be loaded.'), button('Retry collection', '', '', () => { void this.render(); }));
    }
    return section;
  }

  destroy(): void {
    this.disposed = true; this.revision++; this.observer.disconnect();
    window.removeEventListener('keydown', this.onKey, true); window.removeEventListener('command', this.onCommand, true);
    window.removeEventListener('pointerdown', this.onPointer, true);
    this.sections.forEach(section => section.element.remove()); this.sections = []; this.root.remove();
  }
}
