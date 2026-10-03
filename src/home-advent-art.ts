import type { HomeSeasonalArtStyle } from './home-collection-settings';

/** Original, opaque calendar flaps. The number is supplied by the card, so it opens with the flap. */
const doors = new Map<string, string>();

interface Palette {
  paper: string;
  shade: string;
  light: string;
  ink: string;
  inset: string;
}

const classic: Palette[] = [
  { paper: '#963e48', shade: '#572735', light: '#b86565', ink: '#ebce91', inset: '#382e37' },
  { paper: '#315747', shade: '#203d37', light: '#597762', ink: '#e5ce9b', inset: '#21352e' },
  { paper: '#334e65', shade: '#253441', light: '#5c778a', ink: '#e9d6ac', inset: '#263a49' },
  { paper: '#8f573b', shade: '#593d31', light: '#b67e56', ink: '#f1d4a0', inset: '#422f2c' },
];

const storybook: Palette[] = [
  { paper: '#a06c4e', shade: '#704936', light: '#c68e66', ink: '#ffe3bd', inset: '#714d3d' },
  { paper: '#9b5765', shade: '#6b394e', light: '#c3848e', ink: '#ffe3c1', inset: '#643d50' },
  { paper: '#5d8571', shade: '#3a6259', light: '#8aac8b', ink: '#f7e2b9', inset: '#375f51' },
  { paper: '#537e93', shade: '#355064', light: '#80a5b0', ink: '#f6e5c6', inset: '#335565' },
];

function snowflake(x: number, y: number, scale: number, colour: string): string {
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="round"><path d="M-20 0h40M0-20v40m-14-14 28 28m-28 0 28-28M0-20l-5 6m5-6 5 6M20 0l-6-5m6 5-6 5M0 20l-5-6m5 6 5-6M-20 0l6-5m-6 5 6 5"/></g>`;
}

function tree(x: number, y: number, colour: string, detail: string): string {
  return `<g transform="translate(${x} ${y})"><path d="M0-39-20-9h10l-23 30h19l-24 28h76L14 21h19L10-9h10Z" fill="${colour}"/><path d="M-5 48H5v13H-5Z" fill="${detail}"/><path d="M-17 13q18 8 34-1M-24 38q24 9 48 0" fill="none" stroke="${detail}" stroke-width="2"/><g fill="${detail}"><circle cx="-8" cy="2" r="2.5"/><circle cx="10" cy="27" r="2.5"/><circle cx="-11" cy="41" r="2.5"/><path d="m0-56 3 7 8 3-8 3-3 8-3-8-8-3 8-3Z"/></g></g>`;
}

function parcel(x: number, y: number, colour: string, detail: string): string {
  return `<g transform="translate(${x} ${y})"><path d="M-29-19h58v54h-58Z" fill="${colour}" stroke="${detail}" stroke-width="2"/><path d="M-33-25h66v12h-66Z" fill="${colour}" stroke="${detail}" stroke-width="2"/><path d="M-4-25h8v60h-8Z" fill="${detail}"/><path d="M0-25c-35-41-56-9-6 0Zm0 0c35-41 56-9 6 0Z" fill="none" stroke="${detail}" stroke-width="4" stroke-linejoin="round"/></g>`;
}

function bells(x: number, y: number, colour: string, detail: string): string {
  return `<g transform="translate(${x} ${y})"><path d="M-4-18q-25-16-29 8l-10 23 42 13q-5-19 5-31Z" fill="${colour}" stroke="${detail}" stroke-width="2"/><path d="M5-18q25-16 29 8l10 23L2 26q5-19-5-31Z" fill="${colour}" stroke="${detail}" stroke-width="2"/><path d="m-44 14 44 13m2 0 44-13" fill="none" stroke="${detail}" stroke-width="5"/><circle cx="-24" cy="24" r="5" fill="${detail}"/><circle cx="26" cy="24" r="5" fill="${detail}"/><path d="M0-22c-32-27-40 2-8 2L-21 1l13-4 7 7 4-23c31 2 39-26 4-5Z" fill="${detail}"/></g>`;
}

function motif(variant: number, y: number, colour: string, detail: string): string {
  return variant % 3 === 0 ? tree(150, y, colour, detail)
    : variant % 3 === 1 ? parcel(150, y, colour, detail)
      : bells(150, y, colour, detail);
}

function flecks(colour: string, soft: boolean): string {
  return Array.from({ length: 28 }, (_, n) => {
    const x = 37 + (n * 67) % 227;
    const y = 33 + (n * 83) % 373;
    if (x > 73 && x < 227 && y > 135 && y < 305) return '';
    return n % 4 === 0
      ? `<path d="m${x} ${y - 4} 1.4 2.6 3 1.4-3 1.4-1.4 3-1.4-3-3-1.4 3-1.4Z" fill="${colour}" opacity="${soft ? '.72' : '.38'}"/>`
      : `<circle cx="${x}" cy="${y}" r="${n % 3 === 0 ? 1.5 : .8}" fill="${colour}" opacity=".46"/>`;
  }).join('');
}

function paperFlap(variant: number, family: boolean): string {
  const p = (family ? storybook : classic)[variant % 4];
  const edge = family ? '#ffe8c8' : p.ink;
  const candy = variant % 2 ? '#9abc99' : '#c46b78';
  return `<defs><linearGradient id="paper" x2="1" y2="1"><stop stop-color="${p.light}"/><stop offset=".3" stop-color="${p.paper}"/><stop offset="1" stop-color="${p.shade}"/></linearGradient><linearGradient id="fold"><stop stop-color="${p.shade}"/><stop offset=".36" stop-color="${p.light}"/><stop offset="1" stop-color="${p.paper}"/></linearGradient><linearGradient id="foil" x2="1" y2="1"><stop stop-color="${edge}"/><stop offset=".5" stop-color="${family ? '#fff0d6' : '#fff0bd'}"/><stop offset="1" stop-color="${p.light}"/></linearGradient></defs>
    <path d="M0 0h300v440H0Z" fill="${p.shade}"/>
    <path d="M5 5h290v430H5Z" fill="url(#paper)"/>
    <path d="M15 14h266v185q-20 0-20 21t20 21v185H15Z" fill="none" stroke="#190f1d" stroke-width="3" opacity=".36"/>
    <path d="M18 15h264v184q-20 0-20 21t20 21v184H18Z" fill="none" stroke="${edge}" stroke-width="${family ? 2.5 : 1.5}" stroke-dasharray="${family ? '2 6' : '5 4'}" stroke-linecap="round" opacity=".85"/>
    <path d="M18 17h15v407H18Z" fill="url(#fold)"/><path d="M18 17v407" fill="none" stroke="${edge}" stroke-width="1" opacity=".6"/>
    <path d="M36 30h231v380H36Z" fill="none" stroke="url(#foil)" stroke-width="${family ? 5 : 2}" ${family ? 'stroke-linejoin="round"' : ''}/>
    ${family ? `<path d="M36 30h231v380H36Z" fill="none" stroke="${candy}" stroke-width="5" stroke-dasharray="8 12" stroke-linecap="round"/><path d="M46 40h211v360H46Z" fill="none" stroke="${edge}" stroke-width="2" stroke-dasharray="1 8" stroke-linecap="round"/>` : `<path d="M42 36h219v368H42Z" fill="none" stroke="${edge}" stroke-width=".7" opacity=".6"/>`}
    ${flecks(edge, family)}
    ${motif(variant, 95, family ? '#90a984' : p.shade, edge)}
    ${snowflake(87, 349, .62, edge)}${snowflake(213, 349, .62, edge)}
    <path d="M109 374q42 16 84 0M120 382q30 11 60 0" fill="none" stroke="${edge}" stroke-width="${family ? 3 : 1.4}" stroke-linecap="round"/>
    <ellipse cx="150" cy="220" rx="73" ry="82" fill="${p.shade}" opacity=".65"/>
    <ellipse cx="150" cy="217" rx="72" ry="81" fill="${p.inset}" stroke="url(#foil)" stroke-width="${family ? 5 : 3}"/>
    <ellipse cx="150" cy="217" rx="64" ry="73" fill="none" stroke="${edge}" stroke-width="1" ${family ? 'stroke-dasharray="2 6" stroke-linecap="round"' : 'opacity=".55"'}/>
    <path d="m142 128 8-8 8 8-8 8Zm0 177 8-8 8 8-8 8Z" fill="${edge}"/>
    <path d="M282 200q-18 0-18 20t18 20" fill="${p.shade}" stroke="${edge}" stroke-width="1.3"/>
    <path d="m279 212-7 8 7 8" fill="none" stroke="${edge}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function woodFlap(variant: number): string {
  const pine = variant % 2 === 0;
  const base = pine ? '#2e473f' : '#583e36';
  const shade = pine ? '#172e2a' : '#352829';
  const light = pine ? '#566356' : '#897053';
  const grain = Array.from({ length: 24 }, (_, n) => {
    const x = 7 + n * 12;
    const bend = 2 + n % 4;
    return `<path d="M${x} 0q${bend} 47 0 96t${-bend} 91 ${bend} 132 0 121m3-430q${bend} 47 1 80m-1 155q${-bend} 48 0 145" fill="none" stroke="${n % 3 === 0 ? '#e7cf9b' : '#090f11'}" stroke-opacity="${n % 3 === 0 ? '.12' : '.2'}" stroke-width="${n % 2 ? '.7' : '1.3'}"/>`;
  }).join('');
  return `<defs><linearGradient id="wood" x2="1" y2=".15"><stop stop-color="${shade}"/><stop offset=".1" stop-color="${light}"/><stop offset=".3" stop-color="${base}"/><stop offset=".67" stop-color="${shade}"/><stop offset=".83" stop-color="${base}"/><stop offset="1" stop-color="${shade}"/></linearGradient><linearGradient id="gold" x2="1" y2="1"><stop stop-color="#806544"/><stop offset=".18" stop-color="#e3ca91"/><stop offset=".42" stop-color="#a18656"/><stop offset=".61" stop-color="#f5e1ae"/><stop offset=".82" stop-color="#9b7a48"/><stop offset="1" stop-color="#c8a16a"/></linearGradient><radialGradient id="enamel" cx=".4" cy=".2" r=".9"><stop stop-color="#40574b"/><stop offset=".6" stop-color="#243c33"/><stop offset="1" stop-color="#142820"/></radialGradient></defs>
    <path d="M0 0h300v440H0Z" fill="url(#wood)"/>${grain}
    <path d="M13 13h273v187q-19 1-19 20t19 20v187H13Z" fill="none" stroke="#071614" stroke-width="5"/>
    <path d="M16 14h269v187q-18 0-18 19t18 19v186H16Z" fill="none" stroke="#d5b77d" stroke-width="1.3" stroke-dasharray="5 4" opacity=".8"/>
    <path d="M17 18h11v405H17Z" fill="#b89b70" opacity=".18"/><path d="M19 19v401" stroke="#f3d9a2" stroke-opacity=".25"/>
    <path d="M34 29h233v382H34Z" fill="none" stroke="#111e1b" stroke-width="5"/>
    <path d="M33 27h234v382H33Z" fill="none" stroke="url(#gold)" stroke-width="2.5"/><path d="M39 33h222v370H39Z" fill="none" stroke="#ceb47e" stroke-width=".7"/>
    <g fill="none" stroke="url(#gold)" stroke-width="1.5"><path d="M48 69V43h27q-26 3-27 26Zm177-26h27v26q-3-26-27-26ZM48 371v26h27q-26-3-27-26Zm177 26h27v-26q-3 26-27 26Z"/><path d="M45 80q30-8 31-35m179 35q-30-8-31-35M45 360q30 8 31 35m179-35q-30 8-31 35"/></g>
    <g opacity=".86">${motif(variant, 94, shade, '#c9ad77')}${snowflake(150, 351, 1.25, '#c8b181')}</g>
    ${flecks('#d4bd86', false)}
    <ellipse cx="150" cy="221" rx="76" ry="83" fill="#06140f" opacity=".6"/>
    <ellipse cx="150" cy="217" rx="75" ry="82" fill="url(#gold)"/>
    <ellipse cx="150" cy="217" rx="70" ry="77" fill="#111e18"/>
    <ellipse cx="150" cy="217" rx="68" ry="75" fill="url(#enamel)" stroke="#e5c88e" stroke-width="1"/>
    <ellipse cx="150" cy="217" rx="62" ry="69" fill="none" stroke="#8f875d" stroke-width=".6"/>
    <path d="M99 164q-17 16-17 48m13 50q14 25 37 26" fill="none" stroke="#acb6a0" stroke-width="1.4" opacity=".3"/>
    <path d="m144 126 6-7 6 7-6 7Zm0 183 6-7 6 7-6 7Z" fill="url(#gold)"/>
    <path d="M285 201q-18 0-18 19t18 19" fill="#15211d" stroke="url(#gold)" stroke-width="1.7"/><path d="m281 212-7 8 7 8" fill="none" stroke="#d2b982" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** One-based day; twelve repeating colour/motif variants keep a whole calendar coherent. */
export function adventDoorArt(index: number, style: HomeSeasonalArtStyle = 'classic'): string {
  const day = Number.isFinite(index) ? Math.max(1, Math.floor(index)) : 1;
  const variant = (day - 1) % 12;
  // Nightmare is a Halloween style; a stale value uses the ordinary Christmas paper flap.
  const finish = style === 'storybook' || style === 'photoreal' ? style : 'classic';
  const key = `${finish}-${variant}`;
  const cached = doors.get(key);
  if (cached) return cached;
  const art = finish === 'photoreal' ? woodFlap(variant) : paperFlap(variant, finish === 'storybook');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="440" viewBox="0 0 300 440" preserveAspectRatio="none">${art}</svg>`;
  const result = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  doors.set(key, result);
  return result;
}
