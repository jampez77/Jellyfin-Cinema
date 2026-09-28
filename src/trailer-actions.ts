import { button, el, icon } from './dom';
import { isCinemaLayout } from './layout';
import { isIntro, sameMediaId, visible, type ActivePlayback, type PlayerContext } from './player-context';
import type { MediaApi, TrailerActionsContext } from './types';

type Binding = { playback: ActivePlayback; scope: string; route: string; identity: string; revision: number;
  source: string; sourceObject: HTMLVideoElement['srcObject'] };
const scope = (api: MediaApi | null) => api ? JSON.stringify([api.serverId || '', api.userId || '']) : '';
const expected = (playback: ActivePlayback) => ({ PlayingItemId: playback.playingItemId, PlaylistItemId: playback.playlistItemId });
const delay = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

/** Cinema Mode retains its native queue. These controls only advance the native
 * next-track button and ask the server to resolve the playing trailer's owner. */
export class TrailerActions {
  private element = el('section', 'tvl-trailer-actions');
  private controls = el('div', 'tvl-trailer-buttons');
  private skip = button('Skip trailer', 'chevron', 'tvl-trailer-skip', () => { void this.skipTrailer(); });
  private add = button('Add to watchlist', 'plus', 'tvl-trailer-watchlist', () => { void this.addToWatchlist(); });
  private status = el('p', 'tvl-trailer-status');
  private binding: Binding | null = null;
  private model: TrailerActionsContext | null = null;
  private revision = 0;
  private pendingRead = false;
  private lastRead = 0;
  private readRevision = 0;
  private saving = false;
  private skipping = false;
  private destroyed = false;
  private held = new Set<string>();
  private frame: number | undefined;
  private interval: number;
  private observer: MutationObserver;
  private unsubscribe: () => void;

  constructor(private context: PlayerContext, private getApi: () => MediaApi | null) {
    this.element.id = 'tvl-trailer-actions'; this.element.hidden = true;
    this.element.setAttribute('aria-label', 'Trailer actions');
    this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.controls.append(this.add, this.skip); this.element.append(this.controls, this.status);
    this.unsubscribe = context.subscribe(this.schedule);
    this.observer = new MutationObserver(records => {
      if (records.some(record => record.target !== this.element && !this.element.contains(record.target))) this.schedule();
    });
    this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'hidden', 'style', 'aria-hidden', 'open', 'disabled', 'data-tvl-player-browser-open'] });
    for (const name of ['playing', 'pause', 'ended', 'emptied', 'error']) document.addEventListener(name, this.schedule, true);
    window.addEventListener('hashchange', this.schedule); window.addEventListener('popstate', this.schedule);
    document.addEventListener('fullscreenchange', this.schedule);
    window.addEventListener('keydown', this.keyDown, true); window.addEventListener('keyup', this.keyUp, true);
    window.addEventListener('command', this.command, true); window.addEventListener('blur', this.blur);
    this.interval = window.setInterval(this.schedule, 1000);
    this.sync();
  }

  private active(): ActivePlayback | null {
    if (this.destroyed || !isCinemaLayout() || !/(?:^|\/)video\/?(?:\?|$)/i.test(location.hash.replace(/^#/, '') || location.pathname)) return null;
    const playback = this.context.getSnapshot();
    if (!playback || !playback.playingItemId || !visible(playback.osd) || !visible(playback.video)
      || playback.video.ended || playback.video.error) return null;
    // item may already describe the queued feature for in-player browsing.
    return playback.upcomingItemId || isIntro(playback.item)
      || isIntro({ Type: playback.playbackContext?.PlayingItemType, ExtraType: playback.playbackContext?.PlayingItemExtraType })
      ? playback : null;
  }

  private identity(playback: ActivePlayback): string {
    return JSON.stringify([playback.key, playback.playingItemId, playback.playlistItemId || '']);
  }

  private current(binding: Binding): boolean {
    const playback = this.active();
    return !this.destroyed && this.binding === binding && binding.revision === this.revision
      && binding.scope === scope(this.getApi()) && binding.route === location.hash
      && !!playback && this.identity(playback) === binding.identity
      && (playback.video.currentSrc || playback.video.src) === binding.source && playback.video.srcObject === binding.sourceObject
      && (!playback.osd.querySelector<HTMLElement>('.btnUserRating[data-id]')?.dataset.id
        || sameMediaId(playback.osd.querySelector<HTMLElement>('.btnUserRating[data-id]')?.dataset.id, playback.playingItemId));
  }

  private matches(model: TrailerActionsContext | null, binding: Binding): model is TrailerActionsContext {
    return !!model && sameMediaId(model.PlayingItemId, binding.playback.playingItemId)
      && (model.PlaylistItemId || '') === (binding.playback.playlistItemId || '');
  }

  private blocked(playback: ActivePlayback): boolean {
    if (playback.video.paused || document.body.hasAttribute('data-tvl-player-browser-open')) return true;
    const fullscreen = document.fullscreenElement;
    if (fullscreen && !fullscreen.contains(playback.osd)) return true;
    return Array.from(document.querySelectorAll<HTMLElement>(
      '.dialogContainer .dialog.opened, dialog[open], [role="dialog"][aria-modal="true"], #tvEpisodePreview, #previewPopup, #tvl-pause-screen, #video-overlay, #videoOsdPage .upNextContainer'
    )).some(visible);
  }

  private schedule = (): void => {
    if (!this.destroyed && this.frame === undefined) this.frame = requestAnimationFrame(this.sync);
  };

  private reset(): void {
    this.revision++; this.readRevision++; this.binding = null; this.model = null; this.pendingRead = false;
    this.lastRead = 0; this.saving = false; this.skipping = false; this.status.textContent = '';
    this.held.clear(); this.element.hidden = true; this.element.remove();
  }

  private sync = (): void => {
    this.frame = undefined;
    if (this.destroyed) return;
    const playback = this.active(), api = this.getApi();
    if (!playback || !api?.getTrailerActions) { if (this.binding || this.element.isConnected) this.reset(); return; }
    if (!this.binding || this.binding.identity !== this.identity(playback) || this.binding.scope !== scope(api)
      || this.binding.route !== location.hash) {
      this.reset();
      this.binding = { playback, scope: scope(api), route: location.hash, identity: this.identity(playback), revision: this.revision,
        source: playback.video.currentSrc || playback.video.src, sourceObject: playback.video.srcObject };
    }
    const binding = this.binding;
    if (this.element.parentElement !== playback.osd) playback.osd.append(this.element);
    const nativeBottom = playback.osd.querySelector<HTMLElement>('.videoOsdBottom');
    this.element.classList.toggle('tvl-trailer-native-visible', !!nativeBottom && !nativeBottom.classList.contains('videoOsdBottom-hidden') && visible(nativeBottom));
    this.element.hidden = !this.model || this.blocked(playback);
    this.render();
    if (!this.pendingRead && !this.saving && !this.skipping && !this.blocked(playback) && Date.now() - this.lastRead > 5000) {
      this.pendingRead = true; this.lastRead = Date.now();
      const readRevision = ++this.readRevision;
      void api.getTrailerActions(expected(playback)).then(model => {
        if (!this.current(binding) || readRevision !== this.readRevision) return;
        this.model = this.matches(model, binding) ? model : null;
      }).catch(() => { /* Retry later; initial availability must be server-confirmed. */ }).finally(() => {
        if (this.current(binding) && readRevision === this.readRevision) { this.pendingRead = false; this.schedule(); }
      });
    }
  };

  private render(): void {
    this.skip.disabled = this.skipping;
    this.skip.querySelector('span')!.textContent = this.skipping ? 'Skipping…' : 'Skip trailer';
    // Keep the selected control in the TV focus path while saving and after
    // success. Moving focus to Skip here could turn a held Select into a skip.
    this.add.disabled = this.skipping || !this.model?.Movie;
    this.add.setAttribute('aria-disabled', String(this.add.disabled || this.saving || !!this.model?.InWatchlist));
    this.add.querySelector('span')!.textContent = this.saving ? 'Adding…' : this.model?.InWatchlist ? 'In watchlist' : 'Add to watchlist';
    const glyph = this.model?.InWatchlist ? 'check' : 'plus';
    if (this.add.dataset.glyph !== glyph) { this.add.querySelector('svg')?.remove(); this.add.prepend(icon(glyph)); this.add.dataset.glyph = glyph; }
    this.add.title = this.model?.Movie ? this.model.Movie.Name : 'This trailer is not linked to an available movie.';
    if (this.model?.Movie) this.element.dataset.movieId = this.model.Movie.Id;
    else delete this.element.dataset.movieId;
  }

  private async addToWatchlist(): Promise<void> {
    const binding = this.binding, api = this.getApi();
    if (!binding || !api?.addTrailerToWatchlist || !this.current(binding) || this.blocked(binding.playback)
      || !this.model?.Movie || this.model.InWatchlist || this.saving || this.skipping) return;
    this.readRevision++; this.pendingRead = false; this.saving = true; this.status.textContent = ''; this.render();
    try {
      const result = await api.addTrailerToWatchlist(expected(binding.playback));
      if (!this.current(binding)) return;
      if (!this.matches(result, binding) || !sameMediaId(result.Movie?.Id, this.model.Movie.Id) || !result.InWatchlist) {
        throw new Error('The trailer changed. Try again.');
      }
      this.model = result;
      this.status.textContent = `${result.Movie!.Name} added to your watchlist.`;
    } catch (error) {
      if (this.current(binding)) this.status.textContent = error instanceof Error ? error.message : 'Unable to add this movie. Try again.';
    } finally {
      if (this.current(binding)) { this.saving = false; this.render(); }
    }
  }

  private async skipTrailer(): Promise<void> {
    const binding = this.binding, api = this.getApi();
    if (!binding || !api?.getTrailerActions || !this.model || !this.current(binding)
      || this.blocked(binding.playback) || this.skipping) return;
    this.readRevision++; this.pendingRead = false; this.skipping = true; this.status.textContent = ''; this.render();
    try {
      // Re-check at selection time: session reports and trailer changes are asynchronous.
      const latest = await api.getTrailerActions(expected(binding.playback));
      if (!this.current(binding) || this.blocked(binding.playback)) return;
      if (!this.matches(latest, binding)) throw new Error('The trailer changed. Try again.');
      const next = binding.playback.osd.querySelector<HTMLButtonElement>('.btnNextTrack');
      if (!next?.isConnected || next.disabled || next.getAttribute('aria-disabled') === 'true'
        || next.hidden || next.classList.contains('hide')) throw new Error('Skipping is unavailable in this player.');
      // The native next-track action advances one existing queue entry without
      // rebuilding the feature's playlist, source or subtitle selections.
      next.click();
      const started = Date.now();
      while (this.current(binding) && Date.now() - started < 12000) {
        this.context.refresh(); await delay(100);
      }
      if (this.current(binding)) throw new Error('The trailer has not changed. Try again.');
    } catch (error) {
      if (this.current(binding)) this.status.textContent = error instanceof Error ? error.message : 'Unable to skip this trailer. Try again.';
    } finally {
      if (this.current(binding)) { this.skipping = false; this.render(); }
    }
  }

  private consume(event: Event): void { event.preventDefault(); event.stopImmediatePropagation(); }
  private handle(name: string, repeat = false): boolean {
    const focused = document.activeElement;
    if (this.element.hidden || !this.element.contains(focused) || !this.binding || !this.current(this.binding)) return false;
    if (['left', 'right'].includes(name)) {
      const buttons = [this.add, this.skip].filter(control => !control.disabled);
      const index = buttons.indexOf(focused as HTMLButtonElement);
      buttons[(Math.max(0, index) + (name === 'left' ? buttons.length - 1 : 1)) % buttons.length]?.focus({ preventScroll: true });
      return true;
    }
    if (['select', 'enter', 'ok'].includes(name)) {
      if (!repeat && focused instanceof HTMLButtonElement && !focused.disabled && focused.getAttribute('aria-disabled') !== 'true') focused.click();
      return true;
    }
    return false;
  }
  private keyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const name = event.key === 'ArrowLeft' || event.keyCode === 37 ? 'left'
      : event.key === 'ArrowRight' || event.keyCode === 39 ? 'right'
      : event.key === 'Enter' || event.key === ' ' || event.keyCode === 13 || event.keyCode === 32 ? 'select' : '';
    const key = event.code || event.key || String(event.keyCode);
    if (name && this.handle(name, event.repeat || this.held.has(key))) { this.held.add(key); this.consume(event); }
  };
  private keyUp = (event: KeyboardEvent): void => {
    if (this.held.delete(event.code || event.key || String(event.keyCode))) this.consume(event);
  };
  private command = (event: Event): void => {
    const detail = (event as CustomEvent<{ command?: string; repeat?: boolean }>).detail;
    if (!event.defaultPrevented && detail?.command && this.handle(detail.command.toLowerCase(), !!detail.repeat)) this.consume(event);
  };
  private blur = (): void => { this.held.clear(); };

  destroy(): void {
    this.destroyed = true; this.reset(); this.unsubscribe(); this.observer.disconnect(); window.clearInterval(this.interval);
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    for (const name of ['playing', 'pause', 'ended', 'emptied', 'error']) document.removeEventListener(name, this.schedule, true);
    window.removeEventListener('hashchange', this.schedule); window.removeEventListener('popstate', this.schedule);
    document.removeEventListener('fullscreenchange', this.schedule);
    window.removeEventListener('keydown', this.keyDown, true); window.removeEventListener('keyup', this.keyUp, true);
    window.removeEventListener('command', this.command, true); window.removeEventListener('blur', this.blur);
  }
}
