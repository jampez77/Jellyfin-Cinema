import { isDesktopLayout } from './layout';

function visible(node: HTMLElement): boolean {
  if (node.closest('.hide,[hidden],[aria-hidden="true"]')) return false;
  const rect = node.getBoundingClientRect();
  if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= window.innerHeight) return false;
  for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

/** Keep Jellyfin's existing desktop audio controls above full-page Cinema views.
 * Native visibility, playback events and slider handling remain untouched. */
export class DesktopPlayer {
  private footer?: HTMLElement;
  private frame?: number;
  private disposed = false;
  private observer = new MutationObserver(() => this.schedule());
  private resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.schedule()) : undefined;

  constructor() {
    this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-modal'] });
    window.addEventListener('resize', this.schedule);
    document.addEventListener('transitionend', this.schedule, true);
    this.schedule();
  }

  private schedule = (): void => {
    if (!this.disposed && this.frame === undefined) this.frame = requestAnimationFrame(this.sync);
  };

  private sync = (): void => {
    this.frame = undefined;
    if (this.disposed) return;
    const root = document.querySelector<HTMLElement>('body > .tvl-root');
    const footer = document.querySelector<HTMLElement>('.appfooter');
    const bar = footer?.querySelector<HTMLElement>('.nowPlayingBar');
    const modal = Array.from(document.querySelectorAll<HTMLElement>('.dialogContainer .dialog.opened,dialog[open],[role="dialog"][aria-modal="true"]'))
      .some(node => node !== root && visible(node));
    const active = isDesktopLayout() && !!root && !!footer && !!bar && !modal
      && !footer.classList.contains('headroom--unpinned') && !bar.classList.contains('nowPlayingBar-hidden') && visible(bar);
    if (this.footer !== (active ? footer : undefined)) {
      this.footer?.classList.remove('tvl-desktop-player-footer');
      this.resize?.disconnect();
      this.footer = active ? footer : undefined;
      if (this.footer) { this.footer.classList.add('tvl-desktop-player-footer'); this.resize?.observe(this.footer); }
    }
    if (document.body.classList.contains('tvl-desktop-player') !== active) document.body.classList.toggle('tvl-desktop-player', active);
    const height = active ? `${Math.ceil(footer!.getBoundingClientRect().height)}px` : '';
    if (document.body.style.getPropertyValue('--tvl-desktop-player-height') !== height) {
      if (height) document.body.style.setProperty('--tvl-desktop-player-height', height);
      else document.body.style.removeProperty('--tvl-desktop-player-height');
    }
  };

  destroy(): void {
    this.disposed = true;
    this.observer.disconnect(); this.resize?.disconnect();
    window.removeEventListener('resize', this.schedule);
    document.removeEventListener('transitionend', this.schedule, true);
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.footer?.classList.remove('tvl-desktop-player-footer');
    document.body.classList.remove('tvl-desktop-player');
    document.body.style.removeProperty('--tvl-desktop-player-height');
  }
}

/** Full-page views share keyboard focus with the visible desktop audio bar.
 * Dialogs, the profile chooser and TV controls keep their own focus boundaries. */
export function desktopPlayerBar(root: HTMLElement): HTMLElement | null {
  if (!root.matches('.tvl-root') || !isDesktopLayout() || !document.body.classList.contains('tvl-desktop-player')) return null;
  return document.querySelector<HTMLElement>('.tvl-desktop-player-footer .nowPlayingBar');
}
