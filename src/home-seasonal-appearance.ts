import { el } from './dom';
import type { HomeCollectionRow } from './home-collection-settings';
import { seasonalAssetUrl } from './seasonal-asset-url';
import { seasonalBackground, seasonalDoor, seasonalFrame } from './home-seasonal-art';

function decoration(className: string, src: string): HTMLImageElement {
  const image = el('img', className); image.src = src; image.alt = ''; image.draggable = false;
  image.setAttribute('aria-hidden', 'true'); return image;
}

/** Decorative layers never replace the item's accessible name or normal action. */
export function decorateSeasonalCard(card: HTMLElement, row: HomeCollectionRow, index: number): void {
  const appearance = row.appearance;
  const art = card.querySelector<HTMLElement>('.tvl-home-row-art');
  if (!appearance || !art) return;
  card.dataset.seasonalTheme = appearance.theme;
  card.dataset.seasonalReveal = appearance.reveal;
  card.dataset.seasonalCoverStyle = appearance.coverStyle || 'classic';
  card.dataset.seasonalFrameStyle = appearance.frameStyle || 'classic';
  if (appearance.reveal !== 'none') {
    const cover = el('span', 'tvl-seasonal-cover'); cover.setAttribute('aria-hidden', 'true');
    for (const side of ['left', 'right'] as const) {
      const panel = el('span', `tvl-seasonal-panel tvl-seasonal-panel-${side}`);
      if (appearance.reveal === 'doors' || appearance.reveal === 'shutters') {
        const photo = appearance.coverStyle === 'photoreal' || appearance.coverStyle === 'nightmare';
        const src = photo ? seasonalAssetUrl(`${appearance.theme === 'halloween' ? 'halloween-nightmare' : 'christmas-photoreal'}-door.webp`)
          : seasonalDoor(appearance.theme, side, appearance.coverStyle);
        panel.append(decoration(`tvl-seasonal-door-art${photo ? ' tvl-seasonal-full-door' : ''}`, src));
      }
      cover.append(panel);
    }
    if (appearance.theme === 'christmas' && appearance.reveal === 'doors') {
      cover.append(el('span', 'tvl-seasonal-door-number', String(index + 1)));
    }
    art.append(cover);
  }
  if (appearance.frame) {
    const photo = appearance.frameStyle === 'photoreal' || appearance.frameStyle === 'nightmare';
    const src = photo ? seasonalAssetUrl(`${appearance.theme === 'halloween' ? 'halloween-nightmare' : 'christmas-photoreal'}-frame.webp`)
      : seasonalFrame(appearance.theme, appearance.frameStyle);
    art.append(decoration('tvl-seasonal-frame', src));
  }
  if (appearance.reveal === 'shutters') {
    const window = el('span', 'tvl-seasonal-window'); window.setAttribute('aria-hidden','true'); art.append(window);
  }
}

/** Measure once mounted so expansion reveals a fixed scene instead of stretching it. */
export function refreshSeasonalBackdrop(section: HTMLElement): void {
  if (!section.classList.contains('tvl-seasonal-row') || !section.isConnected) return;
  const style = getComputedStyle(section);
  const base = Math.round(section.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
  const factor = section.dataset.seasonalExpansion === 'large' ? 1 : section.dataset.seasonalExpansion === 'medium' ? .5 : 0;
  const extra = Math.max(0, Math.min(base * factor, window.innerHeight * .78 - base));
  const art = `${Math.round(base + extra + 2 * parseFloat(getComputedStyle(document.documentElement).fontSize))}px`;
  if (section.style.getPropertyValue('--tvl-seasonal-art-height') !== art) section.style.setProperty('--tvl-seasonal-art-height', art);
  const space = `${extra / 2}px`;
  if (section.style.getPropertyValue('--tvl-seasonal-space') !== space) section.style.setProperty('--tvl-seasonal-space', space);
}

/** All listeners belong to this row; there are no per-row document observers. */
export function decorateSeasonalRow(section: HTMLElement, cards: HTMLElement, row: HomeCollectionRow): () => void {
  const appearance = row.appearance;
  if (!appearance) return () => {};
  section.classList.add('tvl-seasonal-row');
  section.dataset.seasonalTheme = appearance.theme;
  section.dataset.seasonalBackground = appearance.background;
  section.dataset.seasonalExpansion = appearance.expansion;
  let backdrop: HTMLElement | undefined;
  if (appearance.background !== 'none') {
    backdrop = el('div', 'tvl-seasonal-backdrop'); backdrop.setAttribute('aria-hidden', 'true');
    backdrop.style.backgroundImage = `url("${seasonalBackground(appearance.theme, appearance.backgroundStyle)}")`;
    section.prepend(backdrop);
  }
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const preview = () => !!section.closest('.tvl-home-preview');
  let hovered: HTMLElement | null = null, expanded = false, disposed = false;
  let scrollFrame = 0, settleFrame = 0, focusFrame = 0;
  let until = 0;
  const item = (target: EventTarget | null): HTMLElement | null => {
    const card = target instanceof Element ? target.closest<HTMLElement>('.tvl-home-row-card') : null;
    return card && cards.contains(card) ? card : null;
  };
  // Padding transitions can move the next focused row as the old one closes.
  // Keep the *current* selection visible, never refocus an earlier card.
  const keepSelectionVisible = () => {
    if (disposed || !section.isConnected || preview()) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !active.closest('#homeTab') || active.closest('#homeTab') !== section.closest('#homeTab')) return;
    const header = document.querySelector('.skinHeader:not(.osdHeader)')?.getBoundingClientRect();
    const clearance = Math.max(80, header && header.bottom < window.innerHeight / 2 ? header.bottom + 12 : 0);
    let rect = active.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 16) active.scrollIntoView({block:'nearest',inline:'nearest',behavior:'auto'});
    rect = active.getBoundingClientRect();
    if (rect.top >= clearance) return;
    for (let parent = active.parentElement; parent && rect.top < clearance; parent = parent.parentElement) {
      if (parent.scrollHeight <= parent.clientHeight || !/(auto|scroll|overlay)/.test(getComputedStyle(parent).overflowY)) continue;
      parent.scrollTop += Math.floor(rect.top - clearance) - 1;
      rect = active.getBoundingClientRect();
    }
    if (rect.top < clearance) window.scrollBy(0, Math.floor(rect.top - clearance) - 1);
  };
  const settle = () => {
    cancelAnimationFrame(settleFrame);
    if (preview()) return;
    until = performance.now() + (reduced() ? 40 : 400);
    const follow = () => {
      if (disposed || !section.isConnected) return;
      keepSelectionVisible();
      if (performance.now() < until) settleFrame = requestAnimationFrame(follow);
    };
    settleFrame = requestAnimationFrame(follow);
  };
  const onTransition = (event: TransitionEvent) => {
    if (event.target === section && event.propertyName.startsWith('padding')) keepSelectionVisible();
  };
  const sync = () => {
    if (disposed) return;
    const focused = item(document.activeElement);
    cards.querySelectorAll<HTMLElement>('.tvl-home-row-card[data-seasonal-theme]').forEach(card => {
      card.classList.toggle('tvl-seasonal-item-open', card === focused || card === hovered);
    });
    const active = !!focused;
    section.classList.toggle('tvl-seasonal-focused', active);
    if (appearance.expansion === 'none' || active === expanded) return;
    if (active) refreshSeasonalBackdrop(section);
    expanded = active;
    section.classList.toggle('tvl-seasonal-expanded', active);
    if (focused || !active) settle();
  };
  const onFocus = () => { hovered = null; cancelAnimationFrame(focusFrame); sync(); };
  const onBlur = () => { hovered = null; cancelAnimationFrame(focusFrame); focusFrame = requestAnimationFrame(sync); };
  const onPointer = (event: PointerEvent) => {
    // TV focus and touch activation must not leave a synthetic hover open.
    if (event.pointerType !== 'mouse') return;
    hovered = item(event.target); sync();
  };
  const onLeave = () => { hovered = null; sync(); };
  const updateParallax = () => {
    scrollFrame = 0;
    if (!backdrop || disposed) return;
    const range = cards.scrollWidth - cards.clientWidth;
    const progress = range > 0 ? Math.max(0, Math.min(1, cards.scrollLeft / range)) : .5;
    backdrop.style.backgroundPosition = `${reduced() ? 50 : 35 + progress * 30}% center`;
  };
  const onScroll = () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(updateParallax); };
  refreshSeasonalBackdrop(section);
  section.addEventListener('transitionend', onTransition);
  cards.addEventListener('focusin', onFocus);
  cards.addEventListener('focusout', onBlur);
  cards.addEventListener('pointerover', onPointer);
  cards.addEventListener('pointerleave', onLeave);
  if (appearance.background === 'parallax') { cards.addEventListener('scroll', onScroll, { passive: true }); onScroll(); }
  return () => {
    disposed = true; cancelAnimationFrame(scrollFrame); cancelAnimationFrame(settleFrame); cancelAnimationFrame(focusFrame);
    section.removeEventListener('transitionend', onTransition);
    cards.removeEventListener('focusin', onFocus); cards.removeEventListener('focusout', onBlur);
    cards.removeEventListener('pointerover', onPointer); cards.removeEventListener('pointerleave', onLeave);
    cards.removeEventListener('scroll', onScroll);
  };
}
