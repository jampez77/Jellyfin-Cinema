import { rankArtwork, type HomeSeasonalArtStyle } from './home-collection-settings';

type Theme = 'halloween' | 'christmas';
type Finish = { stops: string; edge: string; shadow: string; light: string; texture: string; decoration: string };
const cache = new Map<string, string>();
const cacheLimit = 128;

const gradient = (colours: string[]): string => colours.map((colour, index) =>
  `<stop offset="${index / (colours.length - 1)}" stop-color="${colour}"/>`).join('');

function web(): string {
  return '<g fill="none" stroke="#fff0c7" stroke-width=".8" opacity=".8"><path d="M79 5 39 5M79 5 41 23M79 5 50 40M79 5 67 49M79 5 80 51M65 5q0 5 2 6t3 6 5 4 4 0M53 5q-1 8 4 11t4 11 9 7 10 0M41 5q0 11 5 17t7 15 13 10 14 0"/></g>';
}

function bat(): string {
  return '<path d="M10 64q8-9 15-4l2-5 3 5q8-4 16 5l-8-1-3 5-5-2-3 6-3-6-6 2-2-5Z" fill="#241b2a" opacity=".88"/>';
}

function pumpkin(): string {
  return '<g transform="translate(36 107)"><path d="M11-2q-2-5 3-6" fill="none" stroke="#91ad60" stroke-width="2.5"/><ellipse cx="12" cy="8" rx="14" ry="11" fill="#ffa34f" stroke="#ffcc81" stroke-width="1"/><path d="M10-2C3 4 3 13 10 19M14-2c7 6 7 15 0 21" fill="none" stroke="#d76c37" stroke-width="1.1"/><path d="m5 5 4-1-1 4m8-4 4 1-3 3" fill="#52343f"/><path d="M7 11q5 6 11 0" fill="none" stroke="#52343f" stroke-width="1.5" stroke-linecap="round"/></g>';
}

function holly(): string {
  return '<g transform="translate(56 15)"><path d="M0 5q-11 1-14-9l5 1-1-5 5 3 2-4q6 6 3 14M3 6q11 3 18-6l-5-1 3-4-6 1 1-5Q5-7 3 6" fill="#276c4b" stroke="#c2be71" stroke-width=".7"/><path d="M-9-4 0 5 15-5" fill="none" stroke="#7dad75" stroke-width=".7"/><circle cx="0" cy="6" r="3.5" fill="#fb746a"/><circle cx="5" cy="7" r="3.5" fill="#bc2939"/><circle cx="2" cy="11" r="3.5" fill="#e9414c"/></g>';
}

function snowflake(x: number, y: number, size = 1): string {
  return `<g transform="translate(${x} ${y}) scale(${size})" fill="none" stroke="#fff7db" stroke-width="1.2" stroke-linecap="round"><path d="M0-8V8M-7-4 7 4M-7 4 7-4M-2-6l2 2 2-2M-2 6l2-2 2 2M-6-1l3-1V-5M6 1 3 2V5M-6 1l3 1V5M6-1 3-2V-5"/></g>`;
}

function finish(theme: Theme, style: HomeSeasonalArtStyle): Finish {
  if (theme === 'christmas') {
    if (style === 'storybook') return {
      stops: gradient(['#fffbe6', '#ffeed2', '#debcb3']), edge: '#fff9dd', shadow: '#602e45', light: '#ffffff',
      texture: '<pattern id="rank-texture" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><path d="M0 0h9v22H0Z" fill="#d94758"/><path d="M14 0h2v22h-2Z" fill="#f18a90"/></pattern>',
      decoration: '<path d="M0 8q7 9 15 1t15 0 15 0 15 0 15 0 15 0" fill="none" stroke="#fffdf1" stroke-width="7" stroke-linecap="round"/><path d="M0 8q7 9 15 1t15 0 15 0 15 0 15 0 15 0" fill="none" stroke="#e5ffeb" stroke-width="1.4"/>' + snowflake(57, 111, .9),
    };
    if (style === 'photoreal') return {
      stops: gradient(['#fff0bc', '#bb8b3d', '#f7dda0', '#a86c27', '#e8bd68', '#6e451d']), edge: '#eddaae', shadow: '#342114', light: '#fff7d7',
      texture: '<pattern id="rank-texture" width="11" height="13" patternUnits="userSpaceOnUse"><path d="M0 1h11M0 7h11" stroke="#fff2d2" stroke-opacity=".14" stroke-width=".5"/><path d="M0 4h11M0 10h11" stroke="#372211" stroke-opacity=".17" stroke-width=".5"/><circle cx="3" cy="9" r=".6" fill="#fff6d8" opacity=".35"/></pattern>',
      decoration: '<path d="M-2 8q13-7 25-2t23-1 23 1 23-1" fill="none" stroke="#fff9ea" stroke-width="6" stroke-linecap="round"/><path d="M4 12v4M31 9v5M55 11v8M75 9v3" stroke="#fff9ea" stroke-width="2.5" stroke-linecap="round"/>' + snowflake(37, 67, .72) + snowflake(66, 119, .55),
    };
    return {
      stops: gradient(['#e0635c', '#ac243b', '#771e32']), edge: '#f3ce80', shadow: '#351721', light: '#ffe9c2',
      texture: '<pattern id="rank-texture" width="22" height="22" patternUnits="userSpaceOnUse"><path d="m11 3 1.5 4.5L17 9l-4.5 1.5L11 15l-1.5-4.5L5 9l4.5-1.5Z" fill="#f8d995" opacity=".35"/></pattern>',
      decoration: holly() + '<path d="M4 117q24-10 48 0t38-1" fill="none" stroke="#edc879" stroke-width="3"/>' + snowflake(23, 60, .65),
    };
  }
  if (style === 'storybook') return {
    stops: gradient(['#bc99e3', '#9365bd', '#634585']), edge: '#e4c8ed', shadow: '#2a233c', light: '#f7e9ff',
    texture: '<pattern id="rank-texture" width="28" height="26" patternUnits="userSpaceOnUse"><path d="m9 3 1.8 4.5L16 9l-5.2 1.5L9 15l-1.8-4.5L2 9l5.2-1.5Z" fill="#ffe6a7" opacity=".85"/><circle cx="23" cy="20" r="1.5" fill="#f1d5fb" opacity=".6"/></pattern>',
    decoration: pumpkin() + '<path d="M14 29q4-11 10-10-3 4-2 8t8 6q-11 5-16-4" fill="#ffe4a6"/>',
  };
  if (style === 'photoreal') return {
    stops: gradient(['#c9c2a4', '#8a8b7b', '#b6af90', '#696e65', '#4a5049']), edge: '#c9c7ac', shadow: '#1e2522', light: '#eee4c4',
    texture: '<pattern id="rank-texture" width="23" height="29" patternUnits="userSpaceOnUse"><path d="m1 2 4 3m8 1 7-2M3 17l6-3m4 8 6 3" stroke="#101b18" stroke-width="1" stroke-opacity=".34"/><path d="m7 8 6 2m-9 13 4 1M16 14l5-1" stroke="#f4eccb" stroke-width=".7" stroke-opacity=".4"/><circle cx="10" cy="26" r="1.2" fill="#403c27" opacity=".45"/></pattern>',
    decoration: '<path d="m22 3 4 15-6 12 10 9-4 16 7 9m-7-46 9 3M20 30l-9 4m50 43-8 9 5 10-10 11 4 11-8 16m14-38 12 3" fill="none" stroke="#303c33" stroke-width="1.1"/><path d="M3 112q10-9 14 1t15 3" fill="none" stroke="#6b7950" stroke-width="5" opacity=".8"/>' + web(),
  };
  if (style === 'nightmare') return {
    stops: gradient(['#eee2c3', '#b9b095', '#d5c7a9', '#827e6c', '#615e55']), edge: '#ded3b8', shadow: '#291e21', light: '#fff1d5',
    texture: '<pattern id="rank-texture" width="27" height="33" patternUnits="userSpaceOnUse"><path d="m6 0 2 9-5 5 6 7-1 12M8 9l9-3m-8 15 10 4" fill="none" stroke="#3e3334" stroke-opacity=".67" stroke-width=".8"/><path d="M17 9v8m4 2v8M13 27v5" stroke="#453d37" stroke-opacity=".24" stroke-width=".6"/></pattern>',
    decoration: '<path d="M-2 117q7-10 13-1t10-4 13 7 12-2 12 1 16-6 17 4v23H-2Z" fill="#641e29" opacity=".9"/><path d="M12 114v-12m24 17V97m31 14V89" stroke="#641e29" stroke-width="2" stroke-linecap="round"/><path d="m25 4 2 19-8 12 11 12-4 11 8 12m-7-47 11-7m-8 31 15-2" fill="none" stroke="#3d3031" stroke-width="1.7"/>' + web(),
  };
  return {
    stops: gradient(['#ffcb77', '#e68b36', '#9e4d23']), edge: '#ffdda1', shadow: '#382031', light: '#fff0c4',
    texture: '<pattern id="rank-texture" width="29" height="29" patternUnits="userSpaceOnUse"><path d="M3 2 1 11M16 14l-2 10" stroke="#683b29" stroke-width="1" stroke-opacity=".2"/></pattern>',
    decoration: web() + bat() + '<path d="M4 120q16-7 27 0t26 1 29-4" fill="none" stroke="#523145" stroke-width="3"/>',
  };
}

/** Self-contained digit artwork; the same silhouettes and aspect ratio as ordinary ranks. */
export function seasonalRankImage(rank: number, theme: Theme, style: HomeSeasonalArtStyle = 'classic'): string {
  // Christmas has no horror preset, including settings retained from a previous theme.
  if (theme === 'christmas' && style === 'nightmare') style = 'classic';
  const { value, width, paths } = rankArtwork(rank);
  const key = `${theme}:${style}:${value}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const art = finish(theme, style);
  const decorations = [...value].map((_, index) => `<g transform="translate(${index * 87} 0)">${art.decoration}</g>`).join('');
  // Reserve a little breathing room for bevels, including wide digits such as 4 and 8.
  // Patterns and ornaments share the glyph clip, so they cannot fill a digit's counter.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 140"><defs><linearGradient id="rank-finish" x1="0" y1="0" x2="1" y2="1">${art.stops}</linearGradient>${art.texture}<clipPath id="rank-cut" clip-rule="evenodd">${paths}</clipPath></defs><g transform="translate(2 1) scale(${(width - 4) / width} .97)" stroke-linejoin="round"><g transform="translate(0 2)" fill="${art.shadow}" stroke="${art.shadow}" stroke-width="1.8" fill-rule="evenodd">${paths}</g><g fill="url(#rank-finish)" stroke="${art.edge}" stroke-width="1.8" fill-rule="evenodd">${paths}</g><g clip-path="url(#rank-cut)"><path d="M0 0h${width}v140H0Z" fill="url(#rank-texture)"/>${decorations}<g transform="translate(-1 -1)" fill="none" stroke="${art.light}" stroke-width=".8" opacity=".65">${paths}</g></g><g fill="none" stroke="${art.edge}" stroke-width=".65" opacity=".8">${paths}</g></g></svg>`;
  const result = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
