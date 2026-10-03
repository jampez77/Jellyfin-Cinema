import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSeasonalAssetUrl } from '../src/seasonal-asset-url';
import { parseSeasonalAppearance, defaultSeasonalAppearance } from '../src/home-collection-settings';

test('seasonal artwork follows the injected server base and its content version', () => {
  assert.equal(resolveSeasonalAssetUrl('halloween-nightmare.webp','https://media.test/jellyfin/TvItemLayout/ClientScript?v=0.2.41.3-hash','https://client.test/web/'),
    'https://media.test/jellyfin/TvItemLayout/SeasonalAsset/halloween-nightmare.webp?v=0.2.41.3-hash');
  assert.equal(resolveSeasonalAssetUrl('christmas-photoreal.webp','https://demo.test/ScreenHarbour/dist/jellyfin-tv-layout.js','https://demo.test/ScreenHarbour/'),
    'https://demo.test/ScreenHarbour/assets/seasonal/christmas-photoreal.webp?v=0.2.41');
});

test('independent art styles survive parsing, retain original defaults, and reject invalid selections', () => {
  const original=defaultSeasonalAppearance('halloween');
  assert.deepEqual(parseSeasonalAppearance(original),original);
  const styled={...original,reveal:'shutters',backgroundStyle:'nightmare',frameStyle:'photoreal',coverStyle:'storybook'} as const;
  assert.deepEqual(parseSeasonalAppearance(styled),styled);
  for(const key of ['backgroundStyle','frameStyle','coverStyle']) {
    assert.equal(parseSeasonalAppearance({...styled,[key]:'https://example.test/image'}),undefined);
    assert.equal(parseSeasonalAppearance({...styled,[key]:null}),undefined);
  }
  assert.equal(parseSeasonalAppearance({...styled,theme:'christmas'}),undefined);
  assert.deepEqual(parseSeasonalAppearance({...styled,theme:'christmas',backgroundStyle:'photoreal'}),{...styled,theme:'christmas',backgroundStyle:'photoreal'});
});
