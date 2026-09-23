type PreviousHostState = { aria: string | null; masked: boolean };

/** Hide native page chrome without removing the controls used by playback.
 * Jellyfin may insert/reuse its native page after our route has already loaded.
 */
export class NativeHostMask {
  private selector = '';
  private hosts = new Map<HTMLElement, PreviousHostState>();
  private observer?: MutationObserver;

  setSelector(selector: string): void {
    if (selector !== this.selector) {
      this.clear();
      this.selector = selector;
      this.observer = new MutationObserver(() => this.sync());
      this.observer.observe(document.body, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'hidden', 'aria-hidden'] });
    }
    this.sync();
  }

  private restore(host: HTMLElement, previous: PreviousHostState): void {
    if (previous.aria === null) host.removeAttribute('aria-hidden');
    else host.setAttribute('aria-hidden', previous.aria);
    if (!previous.masked) host.classList.remove('tvl-native-hidden');
  }

  owns(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && this.hosts.has(target);
  }

  private sync(): void {
    if (!this.selector) return;
    const matches = Array.from(document.querySelectorAll<HTMLElement>(this.selector))
      .filter(host => !host.matches('.tvl-root') && !host.closest('.tvl-root'));
    const retained = new Set(matches);
    for (const [host, previous] of this.hosts) {
      if (!retained.has(host)) {
        this.restore(host, previous);
        this.hosts.delete(host);
      }
    }
    for (const host of matches) {
      if (!this.hosts.has(host)) this.hosts.set(host, {
        aria: host.getAttribute('aria-hidden'), masked: host.classList.contains('tvl-native-hidden')
      });
      if (!host.classList.contains('tvl-native-hidden')) host.classList.add('tvl-native-hidden');
      if (host.getAttribute('aria-hidden') !== 'true') host.setAttribute('aria-hidden', 'true');
    }
  }

  clear(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.selector = '';
    for (const [host, previous] of this.hosts) this.restore(host, previous);
    this.hosts.clear();
  }
}
