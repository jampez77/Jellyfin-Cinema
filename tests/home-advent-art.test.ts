import test from 'node:test';
import assert from 'node:assert/strict';
import { adventDoorArt } from '../src/home-advent-art.ts';

function source(url: string): string {
  assert.ok(url.startsWith('data:image/svg+xml,'));
  return decodeURIComponent(url.slice('data:image/svg+xml,'.length));
}

test('advent flaps fit a poster, hide it completely and leave numbering to the caller', () => {
  for (const style of ['classic', 'storybook', 'photoreal'] as const) {
    for (let day = 1; day <= 25; day++) {
      const svg = source(adventDoorArt(day, style));
      assert.match(svg, /width="300" height="440" viewBox="0 0 300 440"/);
      assert.match(svg, /<path d="M0 0h300v440H0Z" fill="(?:#[0-9a-f]{6}|url\(#[a-z]+\))"\/>/);
      assert.match(svg, /stroke-dasharray="5 4"|stroke-dasharray="2 6"/, 'flaps have a perforated opening');
      assert.match(svg, /<ellipse cx="150" cy="217"/, 'clear centre medallion receives the number');
      assert.doesNotMatch(svg, /<(?:text|image|filter|animate|script|foreignObject)\b/);
      assert.doesNotMatch(svg, /(?:href|src)=|undefined|NaN|Infinity/);
      assert.doesNotMatch(svg, /url\((?!#[a-z]+\))/);
      assert.ok(svg.length < 16000, `${style}/${day} exceeds the static art budget`);
    }
  }
});

test('calendar days have deterministic variations without an unbounded cache', () => {
  for (const style of ['classic', 'storybook', 'photoreal'] as const) {
    assert.notEqual(adventDoorArt(1, style), adventDoorArt(2, style));
    assert.notEqual(adventDoorArt(1, style), adventDoorArt(3, style));
    assert.equal(adventDoorArt(1, style), adventDoorArt(13, style));
    assert.equal(adventDoorArt(13, style), adventDoorArt(25, style));
    assert.equal(adventDoorArt(2.7, style), adventDoorArt(2, style));
  }
  assert.equal(adventDoorArt(1), adventDoorArt(1, 'classic'));
  assert.notEqual(adventDoorArt(1, 'classic'), adventDoorArt(1, 'storybook'));
  assert.notEqual(adventDoorArt(1, 'classic'), adventDoorArt(1, 'photoreal'));
});

test('invalid days and Halloween-only styling fall back to a complete Christmas flap', () => {
  for (const index of [0, -5, NaN, Infinity, -Infinity]) {
    assert.equal(adventDoorArt(index), adventDoorArt(1));
  }
  assert.equal(adventDoorArt(8, 'nightmare'), adventDoorArt(8, 'classic'));
});
