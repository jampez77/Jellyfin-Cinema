import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cloneProviderHomes, defaultProviderHomes, defaultProviderRows, parseProviderHomes, providerHomesKey } from '../src/provider-settings.ts';

test('provider defaults contain each UK service and distinct ranked charts and catalogue rows', () => {
  const settings = defaultProviderHomes();
  assert.deepEqual(settings.providers.map(provider => provider.id), ['netflix', 'prime', 'disney', 'apple', 'now', 'paramount']);
  for (const provider of settings.providers) {
    assert.equal(provider.enabled, true); assert.equal(provider.hero, true);
    assert.deepEqual(provider.rows.map(row => row.source), ['trending-movies', 'trending-shows', 'movies', 'shows']);
    assert.ok(provider.rows.filter(row => row.source.startsWith('trending')).every(row => row.ranked && row.itemSort === 'collection'));
    assert.ok(provider.rows.filter(row => !row.source.startsWith('trending')).every(row => !row.ranked && row.itemSort === 'title'));
  }
  settings.providers[0].rows[0].title = 'Changed';
  assert.equal(settings.providers[1].rows[0].title, 'Trending films');
  assert.equal(defaultProviderHomes().providers[0].rows[0].title, 'Trending films');
});
test('strict parser preserves explicit hidden services, empty pages, row order and blank titles', () => {
  const settings = defaultProviderHomes(); settings.enabled = false; settings.title = '';
  settings.providers.reverse(); settings.providers[0].enabled = false; settings.providers[0].hero = false; settings.providers[0].rows = [];
  settings.providers[1].rows.reverse(); settings.providers[1].rows[0].enabled = false;
  assert.deepEqual(parseProviderHomes(settings), settings);
  assert.deepEqual(parseProviderHomes({ ...settings, providers: [] }).providers, []);
  const copy = cloneProviderHomes(settings); copy.providers[1].rows[0].title = 'Draft';
  assert.notEqual(settings.providers[1].rows[0].title, 'Draft');
});
test('malformed snapshots are rejected without trimming or silently restoring defaults', () => {
  const cases: ((value: any) => void)[] = [
    value => value.version = 2, value => value.extra = true, value => delete value.enabled,
    value => value.enabled = 'false', value => value.title = 'x'.repeat(81), value => value.placement = 'custom',
    value => value.placement = 'native:', value => value.placement = 'native:' + 'x'.repeat(241), value => value.providers.push(value.providers[0]),
    value => value.providers[0].id = 'unknown', value => value.providers[0].hero = 0,
    value => value.providers[0].rows.push(value.providers[0].rows[0]),
    value => value.providers[0].rows[0].id = '', value => value.providers[0].rows[0].id = 'x'.repeat(101),
    value => value.providers[0].rows[0].title = 'x'.repeat(81), value => value.providers[0].rows[0].source = 'studio',
    value => value.providers[0].rows[0].collectionId = 'x'.repeat(200), value => value.providers[0].rows[0].enabled = undefined,
    value => value.providers[0].rows[0].ranked = 'false', value => value.providers[0].rows[0].itemSort = 'custom',
    value => value.providers[0].rows[0].itemOrder = [],
    value => value.providers[0].rows = Array.from({ length: 13 }, (_, index) => ({ ...defaultProviderRows()[0], id: String(index) }))
  ];
  for (const mutate of cases) { const settings = defaultProviderHomes(); mutate(settings); assert.throws(() => parseProviderHomes(settings), /invalid/, mutate.toString()); }
  for (const input of [null, [], {}, false, 'settings']) assert.throws(() => parseProviderHomes(input), /invalid/);
});
test('valid maximum bounds and collection overrides remain exact and user/server keys cannot collide', () => {
  const settings = defaultProviderHomes(); settings.title = 'x'.repeat(80); settings.placement = 'native:' + 'a'.repeat(233);
  settings.providers[0].rows = Array.from({ length: 12 }, (_, index) => ({ ...defaultProviderRows()[0], id: String(index).padEnd(100, 'x'), title: 'y'.repeat(80), collectionId: 'z'.repeat(199) }));
  assert.deepEqual(parseProviderHomes(settings), settings);
  assert.notEqual(providerHomesKey('server:a', 'user'), providerHomesKey('server', 'a:user'));
  assert.notEqual(providerHomesKey('server', 'a'), providerHomesKey('server', 'b'));
  assert.notEqual(providerHomesKey('a', 'user'), providerHomesKey('b', 'user'));
});
