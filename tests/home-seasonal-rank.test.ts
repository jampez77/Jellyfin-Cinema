import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankImage, rankArtwork, type HomeSeasonalArtStyle } from '../src/home-collection-settings.ts';
import { seasonalRankImage } from '../src/home-seasonal-rank.ts';

const variants: ['halloween' | 'christmas', HomeSeasonalArtStyle][] = [
  ['halloween', 'classic'], ['halloween', 'storybook'], ['halloween', 'photoreal'], ['halloween', 'nightmare'],
  ['christmas', 'classic'], ['christmas', 'storybook'], ['christmas', 'photoreal'],
];
const source = (url: string): string => decodeURIComponent(url.slice(url.indexOf(',') + 1));

test('all seasonal rank finishes preserve one-, two- and three-digit geometry and counters', () => {
  for (const [theme, style] of variants) for (const rank of [1, 4, 8, 10, 100, 999]) {
    const svg = source(seasonalRankImage(rank, theme, style));
    const ordinary = source(rankImage(rank));
    assert.equal(svg.match(/viewBox="([^"]+)"/)?.[1], ordinary.match(/viewBox="([^"]+)"/)?.[1]);
    for (const path of rankArtwork(rank).paths.matchAll(/d="([^"]+)"/g)) assert.ok(svg.includes(`d="${path[1]}"`), `${theme}/${style}/${rank}`);
    assert.match(svg, /<clipPath[^>]*clip-rule="evenodd"><path /, 'counters remain clear through every surface decoration');
    assert.doesNotMatch(svg, /undefined|NaN|Infinity/);
  }
});

test('seasonal artwork is self-contained, static and small enough for repeated TV rows', () => {
  for (const [theme, style] of variants) {
    const svg = source(seasonalRankImage(999, theme, style));
    assert.doesNotMatch(svg, /<(?:text|image|filter|animate|script|foreignObject)\b/);
    assert.doesNotMatch(svg, /(?:href|src)=/);
    assert.doesNotMatch(svg, /url\((?!#[a-z-]+\))/);
    assert.ok(svg.length < 16000, `${theme}/${style} exceeds artwork budget: ${svg.length}`);
  }
});

test('all seven finishes are distinct and deterministic, with safe defaults', () => {
  const images = variants.map(([theme, style]) => seasonalRankImage(10, theme, style));
  assert.equal(new Set(images).size, 7);
  for (const [index, [theme, style]] of variants.entries()) assert.equal(seasonalRankImage(10, theme, style), images[index]);
  assert.equal(seasonalRankImage(1, 'halloween'), seasonalRankImage(1, 'halloween', 'classic'));
  assert.equal(seasonalRankImage(1, 'christmas', 'nightmare'), seasonalRankImage(1, 'christmas', 'classic'));
});

test('seasonal rank limits follow ordinary artwork, including malformed runtime values', () => {
  for (const [input, expected] of [[0, 1], [-1, 1], [1.9, 1], [2000, 999], [NaN, 1], [Infinity, 1]]) {
    assert.equal(seasonalRankImage(input, 'halloween'), seasonalRankImage(expected, 'halloween'));
  }
  // Visiting many collections must not change evicted artwork when generated again.
  const first = seasonalRankImage(1, 'christmas', 'storybook');
  for (let rank = 1; rank <= 180; rank++) seasonalRankImage(rank, 'halloween', 'photoreal');
  assert.equal(seasonalRankImage(1, 'christmas', 'storybook'), first);
});
