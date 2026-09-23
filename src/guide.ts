import type { Item, MediaApi } from './types';
import { button, el, icon, picture, replace } from './dom';
import { isLive, plainText, playable, time } from './utils';
import { GUIDE_DURATION, GUIDE_MINUTE, guideSlots, nearestGuideSlot, type GuideSlot } from './guide-layout';

type GuideRow = { channel: Item; programs: Item[]; state: 'loading' | 'ready' | 'error'; request: number };
type Selection = { channelId: string; programId?: string };
type GuideOptions = { currentChannel?: Item; onPlay: (channel: Item) => void; onStatus: (message: string) => void; isCurrent: () => boolean };
const BATCH_SIZE = 16;
const WORKERS = 4;

export class HorizontalGuide {
  readonly element = el('main', 'tvl-epg');
  private heading = el('div', 'tvl-epg-heading');
  private detail = el('section', 'tvl-epg-detail');
  private scroll = el('div', 'tvl-epg-scroll');
  private footer = el('div', 'tvl-epg-footer');
  private rows: GuideRow[] = [];
  private channels: Item[] = [];
  private selection: Selection;
  private windowStart = Math.floor(Date.now() / (30 * GUIDE_MINUTE)) * 30 * GUIDE_MINUTE;
  private disposed = false;
  private revision = 0;
  private busy = false;
  private anchorTime = Date.now();
  private resize = () => this.setWidth();

  constructor(private api: MediaApi, private options: GuideOptions) {
    this.selection = {channelId: options.currentChannel?.Id || ''};
    this.element.setAttribute('aria-label', 'Live TV programme guide');
    this.detail.setAttribute('aria-label', 'Selected programme');
    this.scroll.setAttribute('aria-label', 'Channels and programme schedule');
    this.heading.append(el('div', 'tvl-epg-heading-copy'));
    this.element.append(this.heading, this.detail, this.scroll, this.footer);
    window.addEventListener('resize', this.resize);
    this.renderHeading();
  }

  async load(): Promise<void> {
    const revision = ++this.revision;
    this.busy = true;
    replace(this.detail, el('p', 'tvl-epg-message', 'Loading your channels and programme guide…'));
    replace(this.scroll); replace(this.footer);
    try {
      const channels = await this.api.getChannels();
      if (!this.valid(revision)) return;
      this.channels = channels;
      // An optional channel anchor keeps it in the first bounded batch.
      // The main guide retains Jellyfin's channel order without an anchor.
      const current = channels.find(channel => channel.Id === this.options.currentChannel?.Id);
      const first = current ? [current, ...channels.filter(channel => channel.Id !== current.Id)] : channels;
      this.channels = first;
      this.rows = first.slice(0, BATCH_SIZE).map(channel => ({channel, programs: [], state: 'loading', request: 0}));
      if (!this.rows.length) {
        replace(this.detail, el('h2', '', 'No channels available'), el('p', 'tvl-epg-message', 'Check your Live TV configuration in Jellyfin.'));
        this.busy = false; return;
      }
      this.selection = {channelId: this.rows[0]!.channel.Id};
      this.render();
      await this.fetchRows(this.rows, revision);
      if (!this.valid(revision)) return;
      this.busy = false;
      // Channel controls work while schedules load; keep any choice made then.
      const shouldFocus = document.activeElement === document.body || this.element.contains(document.activeElement);
      const selected = this.rows.find(row => row.channel.Id === this.selection.channelId) || this.rows[0]!;
      const currentSlot = nearestGuideSlot(this.slots(selected), Date.now());
      this.selection = {channelId: selected.channel.Id, programId: currentSlot?.item.Id};
      this.render();
      if (shouldFocus) this.focusSelection();
    } catch {
      if (!this.valid(revision)) return;
      this.busy = false;
      replace(this.detail, el('h2', '', 'Channels unavailable'), el('p', 'tvl-epg-message', 'Try again to load your Live TV guide.'),
        button('Try again', '', 'tvl-epg-retry', () => { void this.load(); }));
      this.detail.querySelector<HTMLButtonElement>('button')?.focus({preventScroll: true});
    }
  }

  async refresh(): Promise<void> {
    if (!this.valid() || this.busy || !this.rows.length) return;
    this.busy = true;
    const revision = this.revision;
    await this.fetchRows(this.rows, revision, true);
    if (!this.valid(revision)) return;
    this.busy = false;
    this.rebaseWindow();
    this.render();
  }

  move(direction: string): boolean {
    const focused = document.activeElement as HTMLElement | null;
    if (!focused || !this.element.contains(focused)) return false;
    const control = focused.closest<HTMLElement>('[data-epg-row]');
    if (!control) {
      if (direction === 'down' && this.detail.contains(focused)) { this.focusSelection(); return true; }
      if (direction === 'up' && focused.classList.contains('tvl-epg-more')) {
        const last = this.rows[this.rows.length - 1];
        if (last) this.focusRow(last, this.anchorTime);
        return true;
      }
      return false;
    }
    const rowIndex = this.rows.findIndex(row => row.channel.Id === control.dataset.epgRow);
    const row = this.rows[rowIndex];
    if (!row) return false;
    const slots = this.slots(row);
    const slotIndex = slots.findIndex(slot => slot.item.Id === focused.dataset.program);
    if (direction === 'left') {
      if (slotIndex > 0) this.focusProgram(row, slots[slotIndex - 1]!);
      else if (slotIndex === 0 || focused.classList.contains('tvl-epg-retry')) this.focusChannel(row);
      return true;
    }
    if (direction === 'right') {
      const next = slotIndex < 0 ? nearestGuideSlot(slots, this.anchorTime) : slots[slotIndex + 1];
      if (next) this.focusProgram(row, next);
      else if (focused.classList.contains('tvl-epg-channel') && !slots.length) {
        const retry = Array.from(this.scroll.querySelectorAll<HTMLButtonElement>('.tvl-epg-retry')).find(node=>node.dataset.epgRow===row.channel.Id);
        retry?.focus({preventScroll:true});if(retry)this.keepVisible(retry);
      }
      return true;
    }
    if (direction === 'up' || direction === 'down') {
      const adjacent = this.rows[rowIndex + (direction === 'up' ? -1 : 1)];
      if (adjacent) {
        if (focused.classList.contains('tvl-epg-channel')) this.focusChannel(adjacent);
        else this.focusRow(adjacent, this.anchorTime);
        return true;
      }
      if (direction === 'down') {
        this.footer.querySelector<HTMLButtonElement>('button')?.focus({preventScroll: true});
        return true;
      }
      const watch = this.detail.querySelector<HTMLButtonElement>('button');
      if (watch) { watch.focus({preventScroll: true}); return true; }
      return false;
    }
    return false;
  }

  focus(): void { if (this.valid()) this.focusSelection(); }

  destroy(): void { this.disposed = true; this.revision++; window.removeEventListener('resize', this.resize); }

  private valid(revision = this.revision): boolean { return !this.disposed && revision === this.revision && this.options.isCurrent(); }
  private slots(row: GuideRow): GuideSlot[] { return guideSlots(row.programs, this.windowStart); }

  private async fetchRows(rows: GuideRow[], revision: number, preserve = false): Promise<void> {
    let next = 0;
    await Promise.all(Array.from({length: Math.min(WORKERS, rows.length)}, async () => {
      while (next < rows.length && this.valid(revision)) {
        const row = rows[next++]!;
        const request = ++row.request;
        try {
          const programs = await this.api.getPrograms(row.channel.Id);
          if (!this.valid(revision) || request !== row.request) continue;
          row.programs = programs.length ? programs : row.channel.CurrentProgram ? [row.channel.CurrentProgram] : [];
          row.state = 'ready';
        } catch {
          if (!this.valid(revision) || request !== row.request) continue;
          if (!preserve || !row.programs.length) row.state = 'error';
        }
      }
    }));
  }

  private renderHeading(): void {
    const copy = el('div', 'tvl-epg-heading-copy');
    copy.append(el('h1', '', 'Live TV'), el('span', 'tvl-epg-date', new Date().toLocaleDateString([], {weekday: 'long', day: 'numeric', month: 'short'})));
    const now = button('Jump to now', 'live', 'tvl-epg-now-button', () => { void this.jumpToNow(); });
    replace(this.heading, copy, now);
  }

  private async jumpToNow(): Promise<void> {
      // Background TV apps can suspend their timers for hours.
      if(Date.now() - this.windowStart >= 30 * GUIDE_MINUTE) await this.refresh();
      if(!this.valid())return;
      this.anchorTime = Date.now(); this.scroll.scrollLeft = 0;
      const row = this.rows.find(row => row.channel.Id === this.selection.channelId) || this.rows[0];
      if (row) this.focusRow(row, this.anchorTime);
  }

  private rebaseWindow(): void {
    const start=Math.floor(Date.now() / (30 * GUIDE_MINUTE)) * 30 * GUIDE_MINUTE;
    if(start===this.windowStart)return;
    const width=this.scroll.querySelector<HTMLElement>('.tvl-epg-time-track')?.offsetWidth || 0;
    const offset=(start-this.windowStart)/GUIDE_DURATION*width;
    this.windowStart=start;
    this.scroll.scrollLeft=Math.max(0,this.scroll.scrollLeft-offset);
    const date=this.heading.querySelector<HTMLElement>('.tvl-epg-date');
    if(date)date.textContent=new Date().toLocaleDateString([], {weekday:'long',day:'numeric',month:'short'});
  }

  private render(): void {
    if (!this.valid()) return;
    const active = document.activeElement as HTMLElement | null;
    const focusedProgram = active?.dataset.program;
    const focusedChannel = active?.dataset.epgRow;
    const focusedWatch = !!active && this.detail.contains(active) && active.tagName === 'BUTTON';
    const focusedMore = active?.classList.contains('tvl-epg-more');
    const scrollLeft = this.scroll.scrollLeft, scrollTop = this.scroll.scrollTop;
    const grid = el('div', 'tvl-epg-grid');
    const header = el('div', 'tvl-epg-timeline');
    const corner = el('div', 'tvl-epg-corner', 'CHANNEL');
    const timeline = el('div', 'tvl-epg-time-track');
    for (let halfHour = 0; halfHour < 48; halfHour++) {
      const at = this.windowStart + halfHour * 30 * GUIDE_MINUTE;
      const label = el('span', 'tvl-epg-time', time(new Date(at).toISOString()));
      label.style.left = `${halfHour / 48 * 100}%`;
      if (new Date(at).getDate() !== new Date(this.windowStart).getDate() && new Date(at).getHours() === 0 && new Date(at).getMinutes() === 0) label.textContent = `Tomorrow ${label.textContent}`;
      timeline.append(label);
    }
    const now = this.nowMarker(true); if (now) timeline.append(now);
    header.append(corner, timeline); grid.append(header);
    for (const row of this.rows) {
      const rowElement = el('div', 'tvl-epg-row'); rowElement.dataset.channelRow = row.channel.Id;
      const channel = el('button', 'tvl-epg-channel'); channel.type = 'button';
      channel.dataset.channel = row.channel.Id; channel.dataset.epgRow = row.channel.Id;
      channel.setAttribute('aria-label', `${row.channel.ChannelNumber || row.channel.Number || ''} ${row.channel.Name}`.trim());
      channel.append(el('span', 'tvl-epg-channel-number', row.channel.ChannelNumber || row.channel.Number || '•'), el('span', 'tvl-epg-channel-name', row.channel.Name));
      channel.addEventListener('focus', () => this.select(row));
      channel.addEventListener('click', () => { this.anchorTime = Date.now(); this.focusRow(row, this.anchorTime); });
      const track = el('div', 'tvl-epg-track');
      const slots = this.slots(row);
      for (const slot of slots) {
        const live = isLive(slot.item);
        const card = el('button', `tvl-epg-program${live ? ' tvl-epg-program-live' : ''}`); card.type = 'button';
        card.dataset.program = slot.item.Id; card.dataset.epgRow = row.channel.Id;
        card.style.left = `${slot.left}%`; card.style.width = `${slot.width}%`;
        card.setAttribute('aria-label', `${row.channel.Name}: ${slot.item.Name}, ${time(slot.item.StartDate)} to ${time(slot.item.EndDate)}${live ? ', live now' : ', upcoming'}`);
        const timing = el('span', 'tvl-epg-program-time', `${time(slot.item.StartDate)} – ${time(slot.item.EndDate)}`);
        if (live) timing.prepend(el('span', 'tvl-epg-live-badge', 'LIVE'));
        card.append(timing, el('span', 'tvl-epg-program-name', slot.item.Name));
        card.addEventListener('focus', () => { this.select(row, slot); this.keepVisible(card); });
        // OK selects details. Playback always has the explicit Watch live action.
        card.addEventListener('click', () => { this.select(row, slot); this.keepVisible(card); });
        track.append(card);
      }
      if (!slots.length) {
        const message = el('div', 'tvl-epg-row-message', row.state === 'loading' ? 'Loading schedule…' : row.state === 'error' ? 'Schedule unavailable' : 'No programme information');
        if (row.state === 'error') {
          const retry = button('Retry', '', 'tvl-epg-retry', () => { void this.retryRow(row); }); retry.dataset.epgRow = row.channel.Id; message.append(retry);
        }
        track.append(message);
      }
      const marker = this.nowMarker(); if (marker) track.append(marker);
      rowElement.append(channel, track); grid.append(rowElement);
    }
    replace(this.scroll, grid);
    this.setWidth();
    this.scroll.scrollLeft = scrollLeft; this.scroll.scrollTop = scrollTop;
    const selected = this.rows.find(row => row.channel.Id === this.selection.channelId) || this.rows[0];
    if (selected) {
      const slot = this.slots(selected).find(slot => slot.item.Id === this.selection.programId);
      this.select(selected, slot);
    }
    replace(this.footer, el('span', 'tvl-epg-hint', '← → Browse programmes     ↑ ↓ Change channel     OK Programme details'));
    if (this.rows.length < this.channels.length) {
      const more = button(this.busy ? 'Loading channels…' : `More channels (${this.rows.length} of ${this.channels.length})`, '', 'tvl-epg-more', () => { void this.moreChannels(); });
      more.disabled = this.busy; this.footer.append(more);
    } else this.footer.append(el('span', 'tvl-epg-count', `${this.rows.length} channels · 24-hour guide`));
    if (focusedChannel) {
      const restored = Array.from(this.scroll.querySelectorAll<HTMLElement>('[data-epg-row]')).find(node => node.dataset.epgRow === focusedChannel && (focusedProgram ? node.dataset.program === focusedProgram : node.classList.contains('tvl-epg-channel')));
      if (restored) restored.focus({preventScroll: true});
      else this.focusSelection();
    } else if (focusedWatch) this.detail.querySelector<HTMLButtonElement>('button')?.focus({preventScroll: true});
    else if (focusedMore) {
      const more = this.footer.querySelector<HTMLButtonElement>('button:not(:disabled)');
      if (more) more.focus({preventScroll:true});
      else if(this.rows.length) this.focusChannel(this.rows[this.rows.length-1]!);
    }
  }

  private select(row: GuideRow, slot?: GuideSlot): void {
    this.selection = {channelId: row.channel.Id, programId: slot?.item.Id};
    this.scroll.querySelectorAll<HTMLElement>('.tvl-epg-program, .tvl-epg-channel').forEach(node => {
      const selected = slot ? node.dataset.program === slot.item.Id && node.dataset.epgRow === row.channel.Id : node.dataset.channel === row.channel.Id;
      node.setAttribute('aria-pressed', String(selected));
    });
    const programme = slot?.item || row.programs.find(program => isLive(program)) || row.channel.CurrentProgram;
    const live = programme && isLive(programme);
    const artwork = picture(programme ? this.api.image(programme, 'thumb') : null, 'tvl-epg-detail-art', programme?.Name || '');
    const placeholder = el('div', 'tvl-epg-art-placeholder');
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.append(icon('episodes'));
    artwork.append(placeholder);
    const copy = el('div', 'tvl-epg-detail-copy');
    const meta = el('div', 'tvl-epg-detail-meta');
    if (programme) meta.append(el('span', live ? 'tvl-epg-detail-badge tvl-epg-detail-live' : 'tvl-epg-detail-badge', live ? 'LIVE NOW' : 'UPCOMING'));
    meta.append(el('span', 'tvl-epg-detail-channel', row.channel.Name));
    if (programme) meta.append(el('span', 'tvl-epg-detail-time', `${time(programme.StartDate)} – ${time(programme.EndDate)}`));
    copy.append(meta, el('h2', 'tvl-epg-detail-title', programme?.Name || 'The guide is taking a break'), el('p', 'tvl-epg-description', plainText(programme?.Overview) || 'Programme information is unavailable. You can still watch this channel live.'));
    const action = el('div', 'tvl-epg-detail-action');
    if (!slot || live) {
      const watch = button('Watch live', 'play', 'tvl-primary tvl-epg-watch', () => {
        if (!this.valid()) return;
        if (slot && !isLive(slot.item)) { this.options.onStatus('This programme is no longer live. Select the current programme to watch.'); this.select(row, slot); return; }
        this.options.onPlay(row.channel);
      }); watch.disabled = !playable(row.channel); action.append(watch);
    } else {
      action.append(icon('clock'), el('span', '', `Starts ${time(programme?.StartDate)}`), el('small', '', 'Upcoming programme'));
    }
    replace(this.detail, artwork, copy, action);
  }

  private nowMarker(label = false): HTMLElement | null {
    const position = (Date.now() - this.windowStart) / GUIDE_DURATION * 100;
    if (position < 0 || position > 100) return null;
    const line = el('div', label ? 'tvl-epg-now tvl-epg-now-label' : 'tvl-epg-now'); line.style.left = `${position}%`;
    line.setAttribute('aria-hidden', 'true'); if (label) line.append(el('span', '', 'NOW')); return line;
  }

  private setWidth(): void {
    const channel = this.scroll.querySelector<HTMLElement>('.tvl-epg-channel');
    const column = channel?.getBoundingClientRect().width || 190;
    const visible = Math.max(360, this.scroll.clientWidth - column);
    this.element.style.setProperty('--tvl-epg-timeline', `${visible * 8}px`);
  }

  private focusSelection(): void {
    const row = this.rows.find(row => row.channel.Id === this.selection.channelId) || this.rows[0];
    if (!row) return;
    const slot = this.slots(row).find(slot => slot.item.Id === this.selection.programId);
    if (slot) this.focusProgram(row, slot); else this.focusChannel(row);
  }

  private focusRow(row: GuideRow, at: number): void {
    const slot = nearestGuideSlot(this.slots(row), at);
    if (slot) this.focusProgram(row, slot, false); else this.focusChannel(row);
  }

  private focusProgram(row: GuideRow, slot: GuideSlot, updateAnchor = true): void {
    if (updateAnchor) this.anchorTime = Math.max(slot.start, this.windowStart);
    const target = Array.from(this.scroll.querySelectorAll<HTMLElement>('[data-program]')).find(node => node.dataset.program === slot.item.Id && node.dataset.epgRow === row.channel.Id);
    target?.focus({preventScroll: true}); if (target) this.keepVisible(target);
  }

  private focusChannel(row: GuideRow): void {
    const target = Array.from(this.scroll.querySelectorAll<HTMLElement>('.tvl-epg-channel')).find(node => node.dataset.channel === row.channel.Id);
    target?.focus({preventScroll: true}); if (target) this.keepVisible(target);
  }

  private keepVisible(node: HTMLElement): void {
    const bounds = this.scroll.getBoundingClientRect(), box = node.getBoundingClientRect();
    const headerHeight = this.scroll.querySelector<HTMLElement>('.tvl-epg-timeline')?.offsetHeight || 44;
    if (box.top < bounds.top + headerHeight) this.scroll.scrollTop -= bounds.top + headerHeight - box.top;
    else if (box.bottom > bounds.bottom) this.scroll.scrollTop += box.bottom - bounds.bottom;
    if (!node.classList.contains('tvl-epg-program')) return;
    const column = this.scroll.querySelector<HTMLElement>('.tvl-epg-channel')?.offsetWidth || 190;
    const visibleStart = bounds.left + column;
    if (box.left < visibleStart) this.scroll.scrollLeft -= visibleStart - box.left;
    else if (box.right > bounds.right) this.scroll.scrollLeft += Math.min(box.right - bounds.right, box.left - visibleStart);
  }

  private async retryRow(row: GuideRow): Promise<void> {
    if (!this.valid() || this.busy) return;
    const revision = this.revision; row.state = 'loading'; this.busy = true; this.render();
    await this.fetchRows([row], revision);
    if (!this.valid(revision)) return;
    this.busy = false; this.render();
  }

  private async moreChannels(): Promise<void> {
    if (!this.valid() || this.busy) return;
    this.busy = true;
    const revision = this.revision;
    const extra: GuideRow[] = this.channels.slice(this.rows.length, this.rows.length + BATCH_SIZE).map(channel => ({channel, programs: [], state: 'loading', request: 0}));
    this.rows.push(...extra); this.render();
    await this.fetchRows(extra, revision);
    if (!this.valid(revision)) return;
    this.busy = false; this.render();
    if (extra[0]) this.focusRow(extra[0], this.anchorTime);
  }
}
