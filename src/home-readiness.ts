type NativeCallback = (...args: unknown[]) => unknown;
type NativeItems = HTMLElement & { fetchData?: NativeCallback; afterRefresh?: NativeCallback | null };
type FetchWatch = { element: NativeItems; original: NativeCallback; wrapped: NativeCallback;
  originalAfter: NativeItems['afterRefresh']; wrappedAfter: NativeCallback; hadAfter: boolean; pending: number; done: boolean };

// Native Home is DOM-cached. Remember empty/error completions too: an empty
// itemsContainer on Back does not imply another first load is in progress.
const completed = new WeakMap<NativeItems, NonNullable<NativeItems['fetchData']>>();

/** Jellyfin's legacy Home has no aggregate ready event. Its native containers
 * expose fetchData; observe completion without calling it or replacing its
 * returned promise. DOM settlement happens after onDataFetched runs.
 * Audited v12.0 homesections.js and emby-itemscontainer.js, also used in 10.11. */
export class HomeReadiness {
  private watches = new Map<NativeItems, FetchWatch>();
  private host?: HTMLElement;
  private deadline?: number;
  private frame?: number;
  private expired = false;
  private ready = false;
  private disposed = false;

  constructor(private changed: () => void) {}

  update(host: HTMLElement): boolean {
    if (this.disposed) return false;
    if (this.ready) return true;
    this.host = host;
    if (this.deadline === undefined) this.deadline = window.setTimeout(() => {
      this.expired = true; this.check();
    }, 8_000);
    this.watch(host);
    this.check();
    return this.ready;
  }

  private watch(host: HTMLElement): void {
    for (const element of Array.from(host.querySelectorAll<NativeItems>('.sections .itemsContainer, .homeSectionsContainer .itemsContainer'))) {
      const original = element.fetchData;
      if (element.closest('.tvl-home-collection-row') || this.watches.has(element) || element.childElementCount
        || typeof original === 'function' && completed.get(element) === original) continue;
      if (typeof original !== 'function') continue;
      const owner = this;
      const watch: FetchWatch = { element, original, wrapped: original, originalAfter: element.afterRefresh, wrappedAfter: original,
        hadAfter: Object.prototype.hasOwnProperty.call(element, 'afterRefresh'), pending: 0, done: false };
      const finished = () => {
        watch.done = true;
        if (!owner.disposed) { completed.set(element, original); if (!owner.ready) owner.check(); }
      };
      watch.wrappedAfter = function (this: NativeItems, ...args: unknown[]): unknown {
        // afterRefresh runs even for empty results and can observe a request
        // that native Home started before Cinema saw its container.
        try { return watch.originalAfter?.apply(this, args); } finally { finished(); }
      };
      watch.wrapped = function (this: NativeItems, ...args: unknown[]): unknown {
        watch.pending++;
        const settled = () => { watch.pending--; finished(); };
        let result: unknown;
        try { result = original.apply(this, args); }
        catch (error) { settled(); throw error; }
        // Observe both outcomes so failed native rows cannot block forever.
        // Return the original promise unchanged for native error handling.
        void Promise.resolve(result).then(settled, settled);
        return result;
      };
      try {
        element.fetchData = watch.wrapped;
        if (element.fetchData === watch.wrapped) {
          this.watches.set(element, watch); element.afterRefresh = watch.wrappedAfter;
        }
      }
      catch { /* Unknown/read-only native implementations use DOM + fallback. */ }
    }
  }

  private settled(): boolean {
    const host = this.host;
    if (!host?.isConnected) return false;
    if (this.expired) return true;
    if (host.querySelector('.sections .centerMessage')) return true;
    const sections = host.querySelector('.sections, .homeSectionsContainer');
    if (!sections?.classList.contains('homeSectionsContainer') || !sections.childElementCount) return false;
    if (!sections.querySelector('.itemsContainer, .homeLibraryButton, .ec-root, .sectionTitle')) return false;
    if (host.querySelector('.ec-placeholder, .ec-bootstrap-placeholder, .sections [aria-busy="true"]')) return false;
    if (document.querySelector('.docspinner.mdlSpinnerActive')) return false;
    for (const watch of this.watches.values()) {
      if (!host.contains(watch.element)) continue;
      if (watch.pending || !watch.done && !watch.element.childElementCount) return false;
    }
    return true;
  }

  private check(): void {
    if (this.ready || this.disposed || this.frame !== undefined || !this.settled()) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = requestAnimationFrame(() => {
        this.frame = undefined;
        if (this.disposed || !this.settled()) return;
        this.ready = true; this.cleanup(); this.changed();
      });
    });
  }

  private cleanup(): void {
    window.clearTimeout(this.deadline);
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    for (const { element, original, wrapped, originalAfter, wrappedAfter, hadAfter } of this.watches.values()) {
      if (element.fetchData === wrapped) element.fetchData = original;
      if (element.afterRefresh === wrappedAfter) {
        if (hadAfter) element.afterRefresh = originalAfter; else delete element.afterRefresh;
      }
    }
    this.watches.clear();
  }
  destroy(): void { this.disposed = true; this.cleanup(); }
}
