/** Original ScreenHarbour seasonal illustrations and locally served photographic artwork. */
import { seasonalAssetUrl } from './seasonal-asset-url';

type SeasonalTheme = 'halloween' | 'christmas';
type SeasonalArtStyle = 'classic' | 'storybook' | 'photoreal' | 'nightmare';
type DoorSide = 'left' | 'right';

const backgrounds: Partial<Record<string, string>> = {};
const doors: Partial<Record<string, string>> = {};
const frames: Partial<Record<string, string>> = {};

function picture(width: number, height: number, artwork: string): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${artwork}</svg>`)}`;
}

function stars(count: number, warm = false): string {
  return Array.from({ length: count }, (_, n) => {
    const x = (n * 197 + 31) % 2400;
    const y = (n * 83 + 19) % 610;
    const radius = n % 11 === 0 ? 2.3 : 0.8 + (n % 3) * 0.35;
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${warm ? '#f8eac9' : '#d5d1e8'}" opacity="${0.16 + (n % 5) * 0.08}"/>`;
  }).join('');
}

function fir(x: number, y: number, scale: number, fill: string, snow = false): string {
  return `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M-10 0h20v-185h-20z" fill="#151d1d"/><path d="M0-340-66-222h36l-72 108h46L-138-3h276L56-114h46L30-222h36Z" fill="${fill}"/>${snow ? '<path d="m0-340-66 118 42-13 24-14 24 14 42 13ZM-31-205l-71 91 46-15 28-18 28 13 28-13 28 18 46 15-71-91 20 45-51-28-51 28ZM-54-97-138-3l66-21 33-23L0-32l39-15L72-24 138-3 54-97l20 40-37-19L0-62l-37-14-37 19Z" fill="#c1d7d7" opacity=".3"/>' : ''}</g>`;
}

function pumpkin(x: number, y: number, size: number, face = false): string {
  return `<g transform="translate(${x} ${y}) scale(${size})"><ellipse cy="8" rx="44" ry="10" fill="#07080d" opacity=".72"/><path d="M-3-46q-3-17 10-20l7 5q-12 3-11 15" fill="#4b5132"/><path d="M0-47C-55-66-61 13-5 13 49 21 60-54 10-47Z" fill="url(#pumpkin)"/><path d="M-9-48c-20 9-23 46-8 60M6-47c21 10 24 45 9 60M0-46C-7-26-7-3-2 13" fill="none" stroke="#6f341c" stroke-width="2" opacity=".75"/>${face ? '<path d="m-29-18 16-10 5 13Zm37 3 5-13 16 10ZM-26-4l13 4 7-5L2 1l8-6 7 4 12-3C15 16-11 17-26-4Z" fill="#f3bf64"/><path d="m-24-17 10-6 3 7Zm35 1 3-7 10 6Z" fill="#ffe4a1"/>' : '<path d="M-35-29q3-9 11-11" stroke="#f6b26b" stroke-width="3" fill="none" opacity=".4"/>'}</g>`;
}

function candle(x: number, y: number, height: number): string {
  return `<g transform="translate(${x} ${y})"><ellipse cy="${-height - 13}" rx="31" ry="44" fill="url(#candleGlow)"/><path d="M-7 0v-${height}q7-5 14 0V0Z" fill="#b89b79"/><path d="M-7-${height}q3 5 6 1v12q3 6 4 0v-12l4-2" fill="#d9c3a0"/><path d="M0-${height + 2}c-9-8-3-15 1-20 1 8 8 14-1 20" fill="#eab16a"/><path d="M0-${height + 3}q-4-7 1-11 3 8-1 11" fill="#ffebad"/><ellipse cy="2" rx="12" ry="3" fill="#343035"/></g>`;
}

function bareTree(x: number, y: number, scale: number, flip = false): string {
  return `<g transform="translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})" fill="#090c14"><path d="M-39 0 5-68-10-139 9-208-8-280 14-371 7-462 31-406 38-319 19-265 44-196 28-132 53-56 76 0Z"/><path d="m17-239-74-57-41-73-57-28-26-61 38 40 62 25 47 64 61 31ZM22-336l-3-60-61-62-12-74 29 58 70 63ZM29-290l72-38 30-86 61-41 32-66-11 78-52 44-15 84-109 62ZM-74-333l-18-71 15-59 3 59 34 56ZM108-335l67-9 48-49-30 66-70 24ZM6-156l-77-37-41-46-87-23 77 3 66 38 80 15Z"/></g>`;
}

function hauntedHouse(): string {
  return `<g transform="translate(270 534)"><path d="m-142 137 286-10 96 62-452 20Z" fill="#080d17"/><path d="M-127 133V-85l61-43 102 24 96 238Z" fill="#0b111d"/><path d="m-156-74 80-97 88 29 50 66-123-21Z" fill="#060b13"/><path d="m-67-151 5-88 37-46 29 49-4 100Z" fill="#0a101b"/><path d="m-78-236 49-87 45 92-53-18Z" fill="#070c15"/><path d="m-31-286 1-37 4-24 4 26 5 36" fill="#111927"/><path d="M22 126V-65l58-24 51 32 13 187Z" fill="#111726"/><path d="m4-53 72-69 83 83-79-24Z" fill="#080d17"/><path d="M63-82v-142l28-37 31 42 2 148Z" fill="#0c1220"/><path d="m51-217 37-79 49 81-44-16Z" fill="#070c15"/><path d="m82-271 6-39 4 15 7 27" fill="#0e1624"/><path d="M-142 136v-15l301-2v18Z" fill="#151b28"/><path d="m-115-63 31-6 1 43-31 3Zm61-6 28 3 3 41-28-2Zm91 42 23-11 2 41-23 6Zm52-13 23 10 2 37-23-8ZM-46-221q8-24 17-1v25h-17Zm127 11q10-25 17 0v26H81Z" fill="#b37642"/><path d="m-115-42 31-5M-99-66l1 40m45-20 27 2m-15-23 3 41M47-33l2 37m40-21 23 7m-13-29 2 39m-64-222v27m126-11v26" fill="none" stroke="#121723" stroke-width="5"/><path d="M-112 13h32v45h-32Zm58 0h29v44h-29Zm94 20h24v39H40Zm51-3h25v42H91Z" fill="#825638"/><path d="M-9 121V63q19-39 36 0v58Z" fill="#201c22"/><path d="M-3 121V65q12-23 23 0v56Z" fill="#986135" opacity=".5"/><path d="m-111 35 30 0m-15-21v42m45-43 1 45m-13-24h27m54-1v39m39-42v43" stroke="#101622" stroke-width="5"/><path d="M-146 94h304m-286-19v44m37-44v44m38-44v44m86-44v44m39-44v44m38-44v44" fill="none" stroke="#050a11" stroke-width="5"/><path d="m-32 137-20 40H65l-31-40Z" fill="#151722"/><path d="M-41 153h86m-94 13h103" stroke="#343038" opacity=".65"/></g>`;
}

function halloweenBackground(): string {
  return picture(2400, 900, `<defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#121326"/><stop offset=".48" stop-color="#171426"/><stop offset="1" stop-color="#15121d"/></linearGradient><radialGradient id="moonHalo"><stop stop-color="#b6adc5" stop-opacity=".19"/><stop offset="1" stop-color="#897fbb" stop-opacity="0"/></radialGradient><radialGradient id="mist"><stop stop-color="#77778c" stop-opacity=".2"/><stop offset="1" stop-color="#595775" stop-opacity="0"/></radialGradient><linearGradient id="pumpkin" x2="1" y2=".8"><stop stop-color="#9b542e"/><stop offset=".45" stop-color="#bd6733"/><stop offset="1" stop-color="#683623"/></linearGradient><radialGradient id="candleGlow"><stop stop-color="#edac60" stop-opacity=".28"/><stop offset="1" stop-color="#edac60" stop-opacity="0"/></radialGradient><linearGradient id="quiet" x2="1"><stop stop-color="#10101c" stop-opacity="0"/><stop offset=".34" stop-color="#10101c" stop-opacity=".34"/><stop offset=".72" stop-color="#10101c" stop-opacity=".3"/><stop offset="1" stop-color="#10101c" stop-opacity="0"/></linearGradient></defs>
    <path fill="url(#sky)" d="M0 0h2400v900H0z"/>${stars(126)}
    <ellipse cx="2010" cy="202" rx="335" ry="260" fill="url(#moonHalo)"/><circle cx="2010" cy="192" r="101" fill="#afa6b4" opacity=".6"/><circle cx="1981" cy="169" r="20" fill="#726e86" opacity=".25"/><circle cx="2046" cy="220" r="27" fill="#777086" opacity=".24"/><circle cx="1983" cy="230" r="10" fill="#68627a" opacity=".17"/><path d="M1824 202q131-42 300 0t276-4v31q-185 16-289-1t-287-7Z" fill="#252336" opacity=".58"/>
    <path d="M0 533q241-74 467 12t438 4 426 11 486-30 583 18v352H0Z" fill="#131728"/><path d="M0 651q220-51 432 4t371-2 560-28 523 25 514-11v261H0Z" fill="#0e1420"/>
    ${hauntedHouse()}${bareTree(18, 717, 1.56)}${bareTree(2391, 744, 1.45, true)}${bareTree(539, 696, .53, true)}${bareTree(2199, 686, .55)}
    <g fill="#080c14"><path d="M1643 128q15-30 31-7l10-7 11 7q22-18 33 12-23-10-42 8-18-20-43-13Z"/><path d="M1784 96q11-22 22-5l7-6 8 6q17-13 24 10-17-8-31 5-12-13-30-10Z"/><path d="M1898 330q14-29 30-7l9-7 11 8q21-18 32 12-23-11-41 8-18-20-41-14Z"/><path d="M2034 370q8-18 17-4l6-5 7 5q13-10 19 7-14-5-25 6-10-12-24-9Z"/></g>
    <ellipse cx="739" cy="653" rx="820" ry="105" fill="url(#mist)"/><ellipse cx="1880" cy="683" rx="761" ry="96" fill="url(#mist)"/>
    <g fill="none" stroke="#090d15" stroke-width="5"><path d="M0 731q520-51 891 14M1643 743q394-53 757-11"/><path d="M17 731v-71m48 69v-84m48 80v-73m47 71v-86m47 83v-77m49 73v-88m49 86v-75m49 72v-85m49 82v-73m49 72v-79m49 80v-72m49 73v-85m49 88v-72m49 78v-85m49 92v-80m49 85v-86m48 92v-74m48 77v-82m49 87v-81M1681 738v-69m49 64v-73m49 69v-85m49 79v-76m49 71v-83m49 79v-69m49 67v-84m49 82v-72m49 71v-83m49 83v-71m49 75v-83m49 86v-73m49 76v-82m49 87v-76"/></g>
    <path d="M0 807q346-48 679 15t647-2 515-12 559-2v94H0Z" fill="#0b0e16"/>
    ${pumpkin(136, 801, 1.45, true)}${pumpkin(237, 824, .96)}${pumpkin(301, 809, .65, true)}${pumpkin(2051, 815, 1.25, true)}${pumpkin(2150, 829, .82)}${pumpkin(2222, 811, .99)}
    ${candle(400, 824, 49)}${candle(429, 829, 33)}${candle(1919, 819, 62)}${candle(1952, 826, 35)}
    <g stroke="#292030" stroke-width="3" fill="none"><path d="M340 843q49-31 115-12t123 8q-31-8-20-23t29 2M1970 851q-111-35-181-6t-87-5q-8-20 14-18t13 15"/></g>
    <g fill="#713f2c" opacity=".6"><path d="m680 807 18-20-2 14 18 2-18 10-3 14-8-15-14 4Zm820 37 12-22 5 13 16-3-11 14 4 12-17-9-12 9ZM1758 783l15-14-1 11 16 3-16 8-5 12-5-13-10 1Z"/></g>
    <path d="M0 0h2400v900H0Z" fill="url(#quiet)"/>`);
}

function cottage(x: number, y: number, scale: number, wall: string, roof = '#27363b'): string {
  return `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M-105 0v-119L0-187l105 68V0Z" fill="${wall}"/><path d="M-124-116 0-213l127 97-16 13L0-181l-110 78Z" fill="${roof}"/><path d="m-127-122 126-99 130 100-19 3-108-76-109 76Z" fill="#bfd0cc" opacity=".65"/><path d="M61-178v-52h22v70" fill="${wall}"/><path d="M57-231h30v8H57Z" fill="#bdd0cc"/><path d="M-76-90h39v50h-39Zm112 0h39v50H36ZM-17-146q17-26 34 0v28h-34Z" fill="#dbad6c"/><path d="M-56-90v50m-20-25h39m92-25v50M36-65h39m-75-94v42" stroke="#2f3434" stroke-width="5"/><path d="M-20 0v-63q20-13 40 0V0Z" fill="#26322f"/><path d="M-14-51h28v22h-28Z" fill="#cd995b"/><circle cx="10" cy="-15" r="3" fill="#be9660"/><path d="M-30 0h60v8h-60ZM-101 1h-26m231 0h26" stroke="#829a99" stroke-width="5"/><path d="M-97-10v-99m195 99v-99" stroke="#8a8b76" stroke-width="5" opacity=".33"/></g>`;
}

function gift(x: number, y: number, width: number, height: number, colour: string, ribbon: string): string {
  return `<g transform="translate(${x} ${y})"><path d="M0 0h${width}v-${height}H0Z" fill="${colour}"/><path d="M-3-${height}h${width + 6}v10H-3Z" fill="${colour}" stroke="#dfc6a6" stroke-opacity=".15"/><path d="M${width * .43} 0v-${height}h${width * .13}V0Z" fill="${ribbon}"/><path d="M${width * .5}-${height}c-45-31-35-45-16-26l16 26c42-28 36-41 17-28Z" fill="none" stroke="${ribbon}" stroke-width="6"/><path d="M5-8h${width - 10}" stroke="#ffe7b8" stroke-opacity=".1"/></g>`;
}

function christmasBackground(): string {
  const lights = Array.from({ length: 33 }, (_, n) => {
    const x = n * 75;
    const y = 90 + Math.sin(n / 32 * Math.PI * 4) * 29;
    return `<circle cx="${x}" cy="${y + 8}" r="22" fill="url(#light)"/><path d="M${x} ${y - 2}v10" stroke="#5d6f5e" stroke-width="3"/><ellipse cx="${x}" cy="${y + 11}" rx="3.7" ry="5" fill="#efcc83"/>`;
  }).join('');
  const needles = Array.from({ length: 65 }, (_, n) => {
    const x = n * 38;
    const y = 50 + Math.sin(n / 64 * Math.PI * 4) * 28;
    return `<path d="m${x - 26} ${y - 22} 27 27-4-34m-22 5 22 26 12-36m-9 37 29-26m-34 33 29-9" stroke="${n % 2 ? '#29463e' : '#203b35'}" stroke-width="5" fill="none"/>`;
  }).join('');
  return picture(2400, 900, `<defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#10222d"/><stop offset=".55" stop-color="#122930"/><stop offset="1" stop-color="#17282b"/></linearGradient><radialGradient id="villageGlow"><stop stop-color="#d8aa64" stop-opacity=".18"/><stop offset="1" stop-color="#d8aa64" stop-opacity="0"/></radialGradient><radialGradient id="light"><stop stop-color="#efd094" stop-opacity=".3"/><stop offset="1" stop-color="#efd094" stop-opacity="0"/></radialGradient><linearGradient id="snow" x2="0" y2="1"><stop stop-color="#718b90" stop-opacity=".28"/><stop offset="1" stop-color="#1e333a" stop-opacity=".15"/></linearGradient><linearGradient id="quiet" x2="1"><stop stop-color="#101920" stop-opacity="0"/><stop offset=".34" stop-color="#101920" stop-opacity=".2"/><stop offset=".72" stop-color="#101920" stop-opacity=".18"/><stop offset="1" stop-color="#101920" stop-opacity="0"/></linearGradient></defs>
    <path fill="url(#sky)" d="M0 0h2400v900H0Z"/>${stars(139, true)}
    <path d="m0 566 158-121 79 67 166-155 164 141 110-63 193 139 167-98 159 82 217-158 180 143 121-86 213 134 153-90v399H0Z" fill="#20373e" opacity=".6"/><path d="m237 512 166-155 164 141-130-87-35 11-26-13-103 96Zm1176-112 180 143-147-92-36 7-30-5-89 70Z" fill="#c0d5d5" opacity=".11"/>
    ${Array.from({ length: 15 }, (_, n) => fir(n * 180 - 34, 663 + n % 3 * 10, .45 + n % 4 * .11, '#173238', true)).join('')}
    <path d="M0 704q272-95 606-35t577 11 554-39 663 30v229H0Z" fill="url(#snow)"/><ellipse cx="295" cy="614" rx="309" ry="221" fill="url(#villageGlow)"/><ellipse cx="2042" cy="650" rx="378" ry="182" fill="url(#villageGlow)"/>
    ${cottage(302, 706, 1.15, '#3d3934')}${cottage(533, 689, .65, '#343c37')}${cottage(1897, 692, .77, '#3d3938')}${cottage(2121, 722, 1.05, '#393d34')}
    <path d="M300 702q158 52 24 179h-92q151-91 41-175M2133 717q-147 60-44 183h65q-111-110-3-180" fill="#859a94" opacity=".17"/>
    ${fir(42, 817, 2.13, '#0d2528', true)}${fir(170, 772, 1.01, '#14302d', true)}${fir(2301, 806, 1.88, '#0c2528', true)}${fir(2400, 796, 1.15, '#14322e', true)}
    <g fill="#d6bd82" opacity=".82"><circle cx="17" cy="437" r="3"/><circle cx="59" cy="490" r="3"/><circle cx="-15" cy="546" r="3"/><circle cx="93" cy="583" r="3"/><circle cx="29" cy="658" r="3"/><circle cx="-28" cy="720" r="3"/><circle cx="104" cy="742" r="3"/><circle cx="2315" cy="365" r="3"/><circle cx="2270" cy="431" r="3"/><circle cx="2332" cy="482" r="3"/><circle cx="2248" cy="570" r="3"/><circle cx="2359" cy="612" r="3"/><circle cx="2290" cy="682" r="3"/><circle cx="2207" cy="744" r="3"/></g>
    <path d="M0 817q484-62 841-5t696-3 863 5v86H0Z" fill="#1c3237"/><path d="M0 817q484-62 841-5t696-3 863 5" fill="none" stroke="#aec6c4" stroke-opacity=".18" stroke-width="3"/>
    ${gift(121, 837, 79, 65, '#643f43', '#ac8b53')}${gift(199, 841, 55, 91, '#304c43', '#b79b62')}${gift(2110, 851, 83, 80, '#6a3f44', '#b2965a')}${gift(2198, 852, 51, 50, '#3e594f', '#bc9e66')}
    <g fill="none" stroke="#223e35" stroke-width="18"><path d="M-20 52q293 97 610 0t596 0 607 0 627 0"/></g>${needles}${lights}
    <g stroke="#9a855b" stroke-width="2"><path d="M253 85v72m513-99v70m825-84v79m529-70v98"/></g><g fill="#783c43" stroke="#ad8b57" stroke-width="2"><circle cx="253" cy="172" r="19"/><circle cx="1591" cy="138" r="16"/></g><g fill="#b09256"><circle cx="766" cy="145" r="17"/><circle cx="2120" cy="166" r="16"/></g><g fill="none" stroke="#e4c188" opacity=".5"><path d="M237 166q16 9 32 0m-27 14 23 0m487-39q14 9 28 0m813-9q14 7 26 0m501 27q14 7 26 0"/></g>
    <g fill="#d9e9e2" opacity=".24">${Array.from({ length: 40 }, (_, n) => `<circle cx="${(n * 263 + 125) % 2400}" cy="${210 + n * 47 % 605}" r="${n % 6 === 0 ? 3 : 1.5}"/>`).join('')}</g><path d="M0 0h2400v900H0Z" fill="url(#quiet)"/>`);
}

/** A self-contained, seamless-to-dark landscape behind the horizontal item rail. */
export function seasonalBackground(theme: SeasonalTheme, style: SeasonalArtStyle = 'classic'): string {
  if (style === 'photoreal' || style === 'nightmare') {
    return seasonalAssetUrl(`${theme}-${theme === 'halloween' && style === 'nightmare' ? 'nightmare' : 'photoreal'}.webp`);
  }
  const key = `${theme}-${style}`;
  return backgrounds[key] ?? (backgrounds[key] = style === 'storybook' ? storybookBackground(theme)
    : theme === 'halloween' ? halloweenBackground() : christmasBackground());
}

function halloweenDoor(side: DoorSide): string {
  const handle = side === 'left' ? 128 : 22;
  const hinge = side === 'left' ? 0 : 150;
  const direction = side === 'left' ? 1 : -1;
  return picture(150, 440, `<defs><linearGradient id="wood" x2="1"><stop stop-color="#1b171b"/><stop offset=".35" stop-color="#34282a"/><stop offset=".8" stop-color="#241d23"/><stop offset="1" stop-color="#110f15"/></linearGradient><linearGradient id="metal" x2="1" y2="1"><stop stop-color="#69706b"/><stop offset=".5" stop-color="#303733"/><stop offset="1" stop-color="#101713"/></linearGradient><radialGradient id="amber"><stop stop-color="#e8ba70"/><stop offset="1" stop-color="#9c663c"/></radialGradient></defs><path d="M0 0h150v440H0Z" fill="url(#wood)"/><g fill="none" stroke="#665044" stroke-opacity=".24"><path d="M9 0q8 59-2 123t4 116-3 111 2 90M37 0q-8 48 0 108t-3 86 2 104-3 142M79 0q9 83 1 145t4 109-4 98 2 88M119 0q-9 72-1 137t-3 109 6 194M22 13q9 58 3 108m27 60q-9 84 2 151m46-263q-8 54-2 118m33 118q-9 30-1 81"/><path d="M17 136q-9 27 0 42 11-21 0-42m53 178q-13 31-1 49 11-25 1-49m40-160q-10 20 0 39 12-19 0-39"/></g><g stroke="#080b10" stroke-width="3"><path d="M48 0v440m52-440v440"/></g><path d="M7 10h136v421H7Z" fill="none" stroke="#5c4b3c" stroke-width="4"/><path d="M12 14h126v410H12Z" fill="none" stroke="#100f13" stroke-width="3"/><g transform="translate(${hinge} 0) scale(${direction} 1)" fill="url(#metal)" stroke="#080c0c" stroke-width="1.5"><path d="M0 81h59l26 12-26 9H0Z"/><path d="M0 340h59l26 12-26 9H0Z"/><circle cx="16" cy="92" r="3" fill="#818477"/><circle cx="49" cy="92" r="3" fill="#818477"/><circle cx="16" cy="352" r="3" fill="#818477"/><circle cx="49" cy="352" r="3" fill="#818477"/></g><g transform="translate(${handle} 223)"><path d="M-8-19q8-11 16 0v37q-8 9-16 0Z" fill="url(#metal)" stroke="#777b69" stroke-opacity=".3"/><circle cy="-7" r="4" fill="#8b876c"/><ellipse cy="6" rx="10" ry="15" stroke="#939077" stroke-width="3" fill="none"/><path d="M-2 9v7h4V9" fill="#080c0e"/></g><g fill="none" stroke="#8d8b7b" stroke-opacity=".24"><path d="M0 0q18 51 60 64M0 0q41 22 74 15M0 0q5 52 13 96M0 15q19 3 28-1M0 34q20-2 43-9M4 54q25-6 49-14M10 79q23-10 49-19M13 16q-5 9-9 13M28 29q-9 15-16 17M42 46q-10 14-22 20"/></g><path d="M18 398q7-14 16-9l-3 15-8 3Z" fill="#3d4836" opacity=".75"/>`);
}

function christmasDoor(side: DoorSide): string {
  const handle = side === 'left' ? 131 : 19;
  return picture(150, 440, `<defs><linearGradient id="red" x2="1" y2=".2"><stop stop-color="#39242f"/><stop offset=".4" stop-color="#663541"/><stop offset="1" stop-color="#3d2632"/></linearGradient><linearGradient id="gold" x2="1" y2="1"><stop stop-color="#8e7546"/><stop offset=".45" stop-color="#d1b174"/><stop offset="1" stop-color="#8b6d43"/></linearGradient></defs><path d="M0 0h150v440H0Z" fill="url(#red)"/><path d="M8 9h134v422H8Z" fill="none" stroke="url(#gold)" stroke-width="4"/><path d="M14 16h122v407H14Z" fill="none" stroke="#bc985a" stroke-opacity=".44"/><path d="M23 27h104v386H23Z" fill="none" stroke="#0d1119" stroke-opacity=".4" stroke-width="5"/><path d="M25 31h100v377H25Z" fill="none" stroke="#cbae78" stroke-opacity=".2"/><g fill="#dbb979" opacity=".28">${Array.from({ length: 14 }, (_, n) => {
    const x = 44 + n % 2 * 60;
    const y = 57 + Math.floor(n / 2) * 54;
    return `<path d="m${x} ${y - 6} 2 4 5 2-5 2-2 5-2-5-5-2 5-2Z"/>`;
  }).join('')}</g><g fill="none" stroke="url(#gold)" stroke-width="1.5" opacity=".75"><path d="M33 41q0 17 20 17-9-11-20-17Zm84 0q0 17-20 17 9-11 20-17ZM33 400q0-17 20-17-9 11-20 17Zm84 0q0-17-20-17 9 11 20 17Z"/><path d="M32 57v50m86-50v50M32 334v50m86-50v50"/></g><g transform="translate(75 105)" fill="none" stroke="#be9a5d" stroke-opacity=".55"><circle r="24"/><circle r="20" stroke-width=".7"/><path d="m0-16 4 11 12 5-12 4-4 12-4-12-12-4 12-5Z"/></g><path d="M74 146h2v155h-2Z" fill="#bc965c" opacity=".08"/><g transform="translate(${handle} 222)"><ellipse rx="7" ry="16" fill="#7e6640" stroke="#c0a064"/><circle cy="-2" r="4" fill="#d8bd81"/><path d="M-1 5v4h2V5" stroke="#3b2930" stroke-width="2"/></g><g transform="translate(75 346)" fill="none" stroke="#caa96b" stroke-opacity=".5"><path d="M-22 0h44M0-22v44m-16-16 32 32m-32 0 32-32M-22 0l6-5m-6 5 6 5m38-5-6-5m6 5-6 5M0-22l-5 6m5-6 5 6M0 22l-5-6m5 6 5-6"/></g>`);
}

/** One 150×440 hinged panel: the matching pair covers a 300×440 poster. */
export function seasonalDoor(theme: SeasonalTheme, side: DoorSide, style: SeasonalArtStyle = 'classic'): string {
  const key = `${theme}-${side}-${style}`;
  return doors[key] ?? (doors[key] = style === 'storybook' ? storybookDoor(theme, side)
    : theme === 'halloween' ? halloweenDoor(side) : christmasDoor(side));
}

function halloweenFrame(): string {
  return picture(300, 440, `<defs><linearGradient id="wood" x2="1" y2=".7"><stop stop-color="#665043"/><stop offset=".35" stop-color="#352831"/><stop offset=".8" stop-color="#46322b"/><stop offset="1" stop-color="#211b23"/></linearGradient><linearGradient id="amber"><stop stop-color="#cb9858"/><stop offset="1" stop-color="#7d5032"/></linearGradient></defs><path d="M0 440V0h300v440H0Zm19-21h262V59L150 19 19 59Z" fill="url(#wood)" fill-rule="evenodd"/><path d="M11 426V51L150 9l139 42v375Z" fill="none" stroke="#927355" stroke-opacity=".62" stroke-width="3"/><path d="M22 416V64l128-39 128 39v352Z" fill="none" stroke="#0c0f16" stroke-width="4"/><path d="m5 410 7-69-5-62 7-70-5-60 5-61M293 411l-8-64 7-70-7-75 6-59-6-55M42 34l51-8 56-20 61 20 47 12" fill="none" stroke="#c49c69" stroke-opacity=".18"/><path d="M0 0h78Q31 14 19 59H0Zm300 0h-78q47 14 59 59h19Z" fill="#13171c"/><g fill="none" stroke="#737568" stroke-opacity=".55"><path d="M3 4 54 20M3 4l25 44M3 4l8 61M15 9q-1 10-7 13m21-7q-2 18-15 28m32-24q-5 25-30 37M297 4l-51 16m51-16-25 44m25-44-8 61m-4-56q1 10 7 13m-21-7q2 18 15 28m-32-24q5 25 30 37"/></g><path d="m139 13 11-8 11 8-3 15-8 8-8-8Z" fill="#25262a" stroke="#8e775e" stroke-width="1.5"/><path d="m143 17 5 1-2 5-4-2Zm9 1 5-1 1 4-4 2Zm-4 8h4l-2-4Z" fill="url(#amber)"/><g stroke="#0d1015" stroke-width="2" fill="#655b45"><path d="M3 114h15v18H3Zm279 0h15v18h-15ZM3 303h15v18H3Zm279 0h15v18h-15Z"/></g><path d="M18 424h264v6H18Z" fill="#9b7650" opacity=".4"/>`);
}

function christmasFrame(): string {
  const needles = Array.from({ length: 12 }, (_, n) => {
    const x = 24 + n * 22;
    const y = 13 + Math.sin(n / 11 * Math.PI) * 6;
    return `<path d="m${x - 12} ${y - 9} 13 15-2-18m-11 18 14-4 9-12m-9 14 15-4"/>`;
  }).join('');
  return picture(300, 440, `<defs><linearGradient id="gold" x2="1" y2="1"><stop stop-color="#b7995f"/><stop offset=".35" stop-color="#e0c68b"/><stop offset=".7" stop-color="#917243"/><stop offset="1" stop-color="#ceac6a"/></linearGradient><linearGradient id="frame" x2="1"><stop stop-color="#354538"/><stop offset=".5" stop-color="#1c3028"/><stop offset="1" stop-color="#354a3a"/></linearGradient></defs><path d="M0 0h300v440H0Zm17 23v400h266V23Z" fill="url(#frame)" fill-rule="evenodd"/><path d="M6 8h288v425H6Z" fill="none" stroke="url(#gold)" stroke-width="4"/><path d="M15 22h270v402H15Z" fill="none" stroke="#b49b64" stroke-width="2"/><path d="M20 27h260v391H20Z" fill="none" stroke="#071614" stroke-width="3"/><g fill="none" stroke="#5d7856" stroke-width="2.6">${needles}</g><g fill="#843f49" stroke="#b99160" stroke-width=".5"><circle cx="61" cy="20" r="3"/><circle cx="66" cy="24" r="2.7"/><circle cx="71" cy="20" r="3"/><circle cx="230" cy="20" r="3"/><circle cx="235" cy="24" r="2.7"/><circle cx="240" cy="20" r="3"/></g><g transform="translate(150 17)"><path d="M0 0C-38-33-38 8-4 8L-18 30l10-2 7 8 5-27C39 8 36-33 0 0Z" fill="#863d49" stroke="#c7936b" stroke-width="1"/><path d="M-5-3h11v13H-5Z" fill="#ac5960"/><path d="M-8 3-26-8M9 3l16-11" stroke="#b96164" stroke-width="2"/></g><g fill="url(#gold)"><path d="m9 82 3 7 7 3-7 3-3 7-3-7-6-3 6-3Zm282 0 3 7 6 3-6 3-3 7-3-7-7-3 7-3ZM9 337l3 7 7 3-7 3-3 7-3-7-6-3 6-3Zm282 0 3 7 6 3-6 3-3 7-3-7-7-3 7-3Z"/></g><g fill="none" stroke="#c9ad72" stroke-width="1.5"><path d="M25 429q13-20 25 0 13-20 25 0m150 0q13-20 25 0 13-20 25 0M108 430h84"/></g><g fill="#8a4650"><path d="m140 429 10-7 10 7-10 7Z"/></g>`);
}

/** Decorative poster surround; its centre stays transparent. */
export function seasonalFrame(theme: SeasonalTheme, style: SeasonalArtStyle = 'classic'): string {
  const key = `${theme}-${style}`;
  return frames[key] ?? (frames[key] = style === 'storybook' ? storybookFrame(theme)
    : theme === 'halloween' ? halloweenFrame() : christmasFrame());
}

function storybookHouse(x: number, y: number, scale: number, christmas: boolean): string {
  const wall = christmas ? '#906041' : '#69518b', roof = christmas ? '#d2afa0' : '#bc764e';
  return `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M-105 0v-135Q-103-164-83-168l176 6q20 3 19 23V0Z" fill="${wall}" stroke="#2a243d" stroke-width="7"/><path d="M-137-139q76-106 122-139 15-12 30 0L140-146q9 14-7 17L2-225l-124 99q-22 4-15-13Z" fill="${roof}" stroke="#2a243d" stroke-width="7"/><path d="M-120-131 0-230l133 97" fill="none" stroke="${christmas ? '#f4ddc5' : '#dfad71'}" stroke-width="10" stroke-linecap="round"/><path d="M-72-105q20-24 43 0v47h-43Zm104 0q20-24 43 0v47H32Z" fill="#f7cf82" stroke="#473749" stroke-width="6"/><path d="M-51-116v58m-21-28h43m83-30v58m-22-28h43" stroke="#6a4850" stroke-width="5"/><path d="M-22 0v-64q23-25 45 0V0Z" fill="${christmas ? '#ad4753' : '#a2a15f'}" stroke="#473749" stroke-width="5"/><circle cx="12" cy="-26" r="4" fill="#f4d6a0"/><circle cy="-191" r="17" fill="#f5cb81" stroke="#503b51" stroke-width="5"/>${christmas ? '<path d="M-89-35v-103m191 103v-101" stroke="#ecd5b9" stroke-width="6" stroke-linecap="round" stroke-dasharray="3 12"/><path d="M-19-235q19-16 38 0M-87-20q-25 13-12 27m174-22q21 9 26 24" stroke="#f0d8bf" stroke-width="6" fill="none"/>' : '<path d="M-100-137q94 66 208 1" stroke="#e5b579" stroke-width="2" fill="none"/><path d="m-75-122 21 7-12 21Zm57 16h22l-11 25Zm59-2 22-6-5 26Z" fill="#e8af66"/>'}</g>`;
}

function friendlyGhost(x: number, y: number, scale: number): string {
  return `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M-38 0q-2-52 36-55 39-2 44 48l14 59-20-10-16 12L2 42l-20 12-17-13-18 7Z" fill="#d5c6dc" stroke="#837393" stroke-width="4"/><ellipse cx="-11" cy="-9" rx="4" ry="7" fill="#514360"/><ellipse cx="14" cy="-9" rx="4" ry="7" fill="#514360"/><path d="M-5 8q9 10 17-1" fill="none" stroke="#746082" stroke-width="3" stroke-linecap="round"/><ellipse cx="-24" cy="5" rx="7" ry="4" fill="#b998ae"/><ellipse cx="27" cy="5" rx="7" ry="4" fill="#b998ae"/></g>`;
}

function storybookBackground(theme: SeasonalTheme): string {
  const christmas = theme === 'christmas';
  const starShapes = Array.from({ length: 21 }, (_, n) => {
    const x = (n * 337 + 89) % 2400, y = 82 + (n * 149) % 320, s = .5 + n % 3 * .3;
    return `<path transform="translate(${x} ${y}) scale(${s})" d="m0-13 4 9 10 4-10 4-4 11-4-11-10-4 10-4Z" fill="${christmas ? '#d7bc87' : '#dba66b'}" opacity=".5"/>`;
  }).join('');
  const garland = Array.from({ length: 25 }, (_, n) => {
    const x = n * 100, y = 105 + Math.sin(n / 24 * Math.PI * 4) * 26;
    return christmas
      ? `<path d="m${x - 29} ${y - 14} 30 17-4-27m-13 31 31-31m-23 33 30-10" fill="none" stroke="#597c65" stroke-width="9" stroke-linecap="round"/><circle cx="${x + 22}" cy="${y + 21}" r="7" fill="${n % 2 ? '#d8ab65' : '#b96b78'}"/>`
      : `<path d="M${x} ${y}v18" stroke="#bd9472" stroke-width="2"/><path d="m${x - 17} ${y + 18}h34v39h-34Z" fill="${n % 2 ? '#ab754f' : '#9981ae'}" stroke="#544165" stroke-width="3"/><path d="M${x - 13} ${y + 35}h26m-13-13v30" stroke="#e2b274" stroke-width="2" opacity=".6"/>`;
  }).join('');
  return picture(2400, 900, `<defs><linearGradient id="storybookSky" x2="0" y2="1"><stop stop-color="${christmas ? '#1d3442' : '#2f2447'}"/><stop offset="1" stop-color="${christmas ? '#304a50' : '#49304d'}"/></linearGradient><linearGradient id="pumpkin" x2="1" y2=".8"><stop stop-color="#d39150"/><stop offset=".5" stop-color="#e6a55a"/><stop offset="1" stop-color="#ac6945"/></linearGradient></defs><path d="M0 0h2400v900H0Z" fill="url(#storybookSky)"/>${stars(105, true)}${starShapes}<path d="M0 111q310 85 604 0t595 0 595 0 606 0" fill="none" stroke="${christmas ? '#42624f' : '#80617b'}" stroke-width="5"/>${garland}
    <path d="M0 618q282-125 599-25t582 4 626-17 593 46v274H0Z" fill="${christmas ? '#53757b' : '#4d395d'}"/><path d="M0 734q276-77 643-5t641-7 637 1 479-13v190H0Z" fill="${christmas ? '#748f93' : '#574062'}"/>
    ${storybookHouse(291, 735, 1.2, christmas)}${storybookHouse(511, 730, .67, christmas)}${storybookHouse(2077, 747, 1.04, christmas)}
    ${christmas ? `${fir(55, 827, 1.8, '#345f55', true)}${fir(2249, 784, 1.28, '#446f5d', true)}${fir(2393, 824, 1.85, '#345f55', true)}${gift(204, 844, 88, 68, '#a95c6b', '#dcc28b')}${gift(1990, 846, 95, 77, '#ac6771', '#ddc28a')}<g transform="translate(1860 782)"><circle cy="-25" r="34" fill="#d5ded7"/><circle cy="-70" r="25" fill="#e6e6d8"/><path d="M-26-82h50l-8-29h-33Z" fill="#695569"/><path d="M-23-47q23 10 46-1v11q-21 12-45 0Z" fill="#b45c6f"/><path d="M5-68 30-62 5-58Z" fill="#c9945d"/><circle cx="-9" cy="-73" r="3" fill="#525665"/><circle cx="7" cy="-73" r="3" fill="#525665"/><circle cy="-19" r="3" fill="#525665"/><circle cy="-34" r="3" fill="#525665"/></g>`
      : `<path d="M1855 212a87 87 0 1 0 127 93 87 87 0 0 1-127-93" fill="#dfc592" opacity=".75"/>${friendlyGhost(685, 703, .92)}${friendlyGhost(1822, 738, 1.08)}${pumpkin(113, 811, 1.9, true)}${pumpkin(254, 851, 1.12)}${pumpkin(2097, 833, 1.65, true)}${pumpkin(2215, 856, 1.1)}<g fill="#c2905d"><path d="M40 244q26-31 42-7l10-8 11 8q27-17 47 16-34-6-55 9-25-17-55-18Zm2135 386q21-24 36-4l7-6 10 6q21-15 36 13-28-7-44 7-19-14-45-16Z"/></g>`}
    <path d="M0 867q630-34 1170-2t1230-3v38H0Z" fill="${christmas ? '#304b50' : '#362b45'}" opacity=".8"/>`);
}

function storybookDoor(theme: SeasonalTheme, side: DoorSide): string {
  const christmas = theme === 'christmas', handle = side === 'left' ? 130 : 20;
  const motif = christmas
    ? '<path d="M75 69 48 111h13l-22 35h20l-22 32h77l-23-32h19l-22-35h13Z" fill="#769a7d" stroke="#e6cba3" stroke-width="2"/><circle cx="72" cy="109" r="4" fill="#d4a775"/><circle cx="79" cy="132" r="4" fill="#be6e79"/><circle cx="64" cy="158" r="4" fill="#dfb777"/><path d="M71 178h8v17h-8Z" fill="#dab987"/>'
    : '<path d="M73 161q-26-15-36-54-3-23 20-16l18 13q37-30 43-1 7 33-35 58Z" fill="#d29967"/><ellipse cx="62" cy="121" rx="4" ry="6" fill="#634563"/><ellipse cx="89" cy="121" rx="4" ry="6" fill="#634563"/><path d="M63 137q12 12 26-1" fill="none" stroke="#76516d" stroke-width="3"/><path d="M75 102q-4-20 11-25" stroke="#90a268" stroke-width="6" fill="none"/>';
  return picture(150, 440, `<path d="M0 0h150v440H0Z" fill="${christmas ? '#90644d' : '#765687'}"/><path d="M10 9h130v421H10Z" fill="none" stroke="${christmas ? '#f0d6b6' : '#cfac78'}" stroke-width="7" stroke-linejoin="round"/><path d="M22 24h106v391H22Z" fill="none" stroke="${christmas ? '#c59970' : '#a482aa'}" stroke-width="2" stroke-dasharray="3 9" stroke-linecap="round"/>${motif}<g fill="${christmas ? '#ddb48c' : '#bea0c8'}" opacity=".8"><path d="m75 303 5 10 11 5-11 5-5 11-5-11-11-5 11-5Z"/><circle cx="49" cy="351" r="3"/><circle cx="103" cy="275" r="3"/><circle cx="43" cy="259" r="3"/><circle cx="104" cy="361" r="3"/></g><circle cx="${handle}" cy="226" r="7" fill="#e6c587" stroke="#765a48" stroke-width="2"/>`);
}

function storybookFrame(theme: SeasonalTheme): string {
  const christmas = theme === 'christmas';
  return picture(300, 440, `<path d="M0 0h300v440H0Zm20 26v394h260V26Z" fill="${christmas ? '#b06e59' : '#76558a'}" fill-rule="evenodd"/><path d="M9 11h282v419H9Z" fill="none" stroke="${christmas ? '#f1d8b7' : '#d6af7c'}" stroke-width="7" stroke-linejoin="round"/><path d="M20 27h260v391H20Z" fill="none" stroke="${christmas ? '#e5b881' : '#c199b8'}" stroke-width="3" stroke-linejoin="round" stroke-dasharray="3 8" stroke-linecap="round"/><g fill="${christmas ? '#9aa783' : '#d29a69'}"><path d="m145 3 5 9 10 3-10 4-5 9-4-9-10-4 10-3Z"/><circle cx="50" cy="12" r="4"/><circle cx="247" cy="12" r="4"/></g>${christmas ? '<path d="m4 47 9-9m-9 20 9-9m274-1 10-10m-10 21 10-10M4 387l9-9m-9 20 9-9m274-1 10-10m-10 21 10-10" stroke="#bc6572" stroke-width="5"/><path d="M139 429q11-13 22 0" fill="none" stroke="#f1d8b7" stroke-width="4"/>' : '<g fill="#c9b5d2"><path d="M3 90q7-15 14 0v20l-4-3-4 3-3-3-4 3Z"/><path d="M283 325q7-15 14 0v20l-4-3-4 3-3-3-4 3Z"/></g><g fill="#735280"><circle cx="7" cy="92" r="1.5"/><circle cx="12" cy="92" r="1.5"/><circle cx="287" cy="327" r="1.5"/><circle cx="292" cy="327" r="1.5"/></g>'}`);
}
