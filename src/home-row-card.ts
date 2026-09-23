import type { Item, MediaApi } from './types';
import { el, picture } from './dom';
import { rankImage } from './home-collection-settings';

/** The same artwork and sizing for a saved Home row and its non-interactive draft. */
export function homeRowCard(api: MediaApi, item: Item, rank?: number, onSelect?: () => void): HTMLElement {
  const card = onSelect ? el('button') : el('div');
  card.className = `tvl-home-row-card${rank ? ' tvl-home-ranked' : ''}`;
  card.dataset.itemId = item.Id;
  card.setAttribute('aria-label', rank ? `Rank ${rank}: ${item.Name}` : item.Name);
  if (card instanceof HTMLButtonElement) {
    card.type = 'button'; card.addEventListener('click', onSelect!);
  } else card.setAttribute('role', 'img');
  if (rank) {
    const artwork = el('img', 'tvl-home-rank'); artwork.src = rankImage(rank); artwork.alt = ''; artwork.setAttribute('aria-hidden', 'true'); card.append(artwork);
  }
  const cover = el('div', 'tvl-home-row-cover');
  cover.append(picture(api.image(item, 'poster'), 'tvl-home-row-art'), el('span', 'tvl-home-row-caption', item.Name));
  card.append(cover);
  return card;
}
