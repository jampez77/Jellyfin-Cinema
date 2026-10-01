import { el } from './dom';
import type { LoadingScreenSettings } from './loading-settings';

/*! Jellyfin logo by the Jellyfin Project, CC BY-SA 4.0.
 * Source: https://github.com/jellyfin/jellyfin-ux/blob/master/logos/SVG/jellyfin-icon--color-on-dark.svg
 * License: https://creativecommons.org/licenses/by-sa/4.0/
 * Original SVG paths and colours are unchanged; CSS animates the whole image.
 * Jellyfin is not affiliated with or the publisher of ScreenHarbour.
 */
const jellyfinLogo = `<svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#clip0_2138_3705)">
<path d="M24.2116 49.1581C22.6599 46.0424 32.8378 27.5879 35.9999 27.5879C39.1666 27.5895 49.3228 46.0764 47.7882 49.1581C46.2536 52.2398 25.7632 52.2738 24.2116 49.1581Z" fill="url(#paint0_linear_2138_3705)"/>
<path fill-rule="evenodd" clip-rule="evenodd" d="M0.481861 64.9951C-4.19479 55.6047 26.4765 0 36 0C45.5328 0 76.153 55.713 71.5274 64.9951C66.9018 74.2773 5.15852 74.3856 0.481861 64.9951ZM12.7358 56.847C15.8005 62.9995 56.2536 62.9314 59.2843 56.847C62.3149 50.761 42.2515 14.2605 36.0093 14.2605C29.767 14.2605 9.67118 50.6944 12.7358 56.847Z" fill="url(#paint1_linear_2138_3705)"/>
</g>
<defs>
<linearGradient id="paint0_linear_2138_3705" x1="11.9999" y1="30.0006" x2="71.9989" y2="63.0024" gradientUnits="userSpaceOnUse">
<stop stop-color="#AA5CC3"/>
<stop offset="1" stop-color="#00A4DC"/>
</linearGradient>
<linearGradient id="paint1_linear_2138_3705" x1="12" y1="29.9992" x2="71.999" y2="63.001" gradientUnits="userSpaceOnUse">
<stop stop-color="#AA5CC3"/>
<stop offset="1" stop-color="#00A4DC"/>
</linearGradient>
<clipPath id="clip0_2138_3705">
<rect width="72" height="72" fill="white"/>
</clipPath>
</defs>
</svg>
`;

function projector(): HTMLElement {
  const art = el('div', 'tvl-home-loading-projector');
  art.append(el('div', 'tvl-home-loading-beam'));
  for (const side of ['left', 'right']) {
    const reel = el('div', `tvl-home-loading-reel tvl-home-loading-reel-${side}`);
    for (let index = 0; index < 3; index++) reel.append(el('i'));
    art.append(reel);
  }
  art.append(el('div', 'tvl-home-loading-camera'), el('div', 'tvl-home-loading-lens'), el('div', 'tvl-home-loading-foot'));
  return art;
}
function clapperboard(): HTMLElement {
  const art = el('div', 'tvl-loading-clapperboard');
  const board = el('div', 'tvl-loading-clapper-body');
  board.append(el('span', 'tvl-loading-clapper-title', 'PICTURE START'));
  const details = el('div', 'tvl-loading-clapper-details'); details.append(el('span', '', 'SCENE 01'), el('span', '', 'TAKE 01'));
  board.append(details, el('div', 'tvl-loading-clapper-line'));
  art.append(board, el('div', 'tvl-loading-clapper-top'), el('div', 'tvl-loading-clapper-hinge'));
  return art;
}
function filmReel(): HTMLElement {
  const art = el('div', 'tvl-loading-film-reel');
  const strip = el('div', 'tvl-loading-film-tail');
  for (let index = 0; index < 4; index++) strip.append(el('i'));
  const wheel = el('div', 'tvl-loading-film-wheel');
  for (let index = 0; index < 5; index++) wheel.append(el('i'));
  wheel.append(el('span', 'tvl-loading-film-hub'));
  art.append(strip, wheel); return art;
}
function countdown(): HTMLElement {
  const art = el('div', 'tvl-loading-countdown');
  art.append(el('div', 'tvl-loading-countdown-cross'), el('div', 'tvl-loading-countdown-ring'), el('div', 'tvl-loading-countdown-sweep'));
  for (const value of [3, 2, 1]) art.append(el('span', `tvl-loading-countdown-number tvl-loading-countdown-${value}`, String(value)));
  return art;
}
function spotlights(): HTMLElement {
  const art = el('div', 'tvl-loading-spotlights');
  art.append(el('div', 'tvl-loading-spot-stage'));
  for (const side of ['left', 'right']) {
    art.append(el('div', `tvl-loading-spot-beam tvl-loading-spot-beam-${side}`), el('div', `tvl-loading-spot-lamp tvl-loading-spot-lamp-${side}`));
  }
  const stars = el('div', 'tvl-loading-spot-stars');
  for (let index = 0; index < 3; index++) stars.append(el('i'));
  art.append(stars); return art;
}
function jellyfin(): HTMLElement {
  const art = el('div', 'tvl-loading-jellyfin');
  const logo = el('img', 'tvl-loading-jellyfin-logo');
  // The data URL keeps the original vector self-contained on an offline TV.
  logo.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(jellyfinLogo)}`;
  logo.alt = ''; logo.draggable = false;
  art.append(el('div', 'tvl-loading-jellyfin-glow'), logo); return art;
}

/** Shared artwork for the fixed Home loader and the settings-page previews. */
export function loadingAnimation(settings: Pick<LoadingScreenSettings, 'animation' | 'brandText' | 'message'>, preview = false): HTMLElement {
  const status = el('div', `tvl-loading-animation ${preview ? 'tvl-loading-preview' : 'tvl-home-loading-status'}`);
  status.dataset.animation = settings.animation;
  if (!preview) {
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-label', 'Loading Home');
  }
  const art = el('div', 'tvl-loading-art'); art.setAttribute('aria-hidden', 'true');
  const create = { projector, clapperboard, 'film-reel': filmReel, countdown, spotlights, jellyfin }[settings.animation] || projector;
  art.append(create());
  const copy = el('div', 'tvl-home-loading-copy');
  if (settings.brandText) copy.append(el('span', 'tvl-home-loading-brand', settings.brandText));
  if (settings.message) copy.append(el('span', 'tvl-home-loading-label', settings.message));
  const dots = el('span', 'tvl-home-loading-dots'); dots.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < 3; index++) dots.append(el('i'));
  status.append(art, copy, dots); return status;
}
