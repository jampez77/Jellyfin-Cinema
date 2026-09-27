import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cloneProviderHomes, defaultProviderHomes, defaultProviderRows, defaultProviderConfig, defaultCustomProvider, parseProviderHomes, providerHomesKey, validProviderId, maxProviders } from '../src/provider-settings.ts';

test('provider defaults contain each UK service and distinct ranked charts and catalogue rows', () => {
  const settings = defaultProviderHomes();
  assert.deepEqual(settings.providers.map(provider => provider.id), ['netflix', 'prime', 'disney', 'apple', 'now', 'paramount', 'bbc', 'itvx', 'channel4']);
  assert.equal(settings.version, 2); assert.equal(settings.tileScale, 100); assert.equal(settings.showNames, true);
  for (const provider of settings.providers.slice(0, 6)) {
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
    value => value.version = 3, value => value.extra = true, value => delete value.enabled,
    value => value.enabled = 'false', value => value.title = 'x'.repeat(81), value => value.placement = 'custom',
    value => value.placement = 'native:', value => value.placement = 'native:' + 'x'.repeat(241), value => value.providers.push(value.providers[0]),
    value => value.providers[0].id = 'unknown', value => value.providers[0].hero = 0,
    value => value.tileScale = 69, value => value.tileScale = 151, value => value.tileScale = 99.5, value => value.showNames = 'true',
    value => value.providers[0].name = '', value => value.providers[0].name = ' ', value => value.providers[0].name = 'x'.repeat(81),
    value => value.providers[0].accent = '#fff', value => value.providers[0].accent = 'red',
    value => value.providers[0].logoUrl = 'data:image/svg+xml,stuff', value => value.providers[0].logoUrl = 'https://name:pass@example.com/image.png',
    value => value.providers[0].logoUrl = '/image.png', value => value.providers[0].logoUrl = 'https://example.com/' + 'x'.repeat(2048),
    value => value.providers[0].movieProviderIds = [0], value => value.providers[0].movieProviderIds = [1, 1],
    value => value.providers[0].movieProviderIds = [1.5], value => value.providers[0].showProviderIds = [1000001],
    value => value.providers[0].showProviderIds = ['8'], value => value.providers[0].showProviderIds = Array.from({length:21}, (_, i) => i + 1),
    value => value.providers[0].offerTypes = [], value => value.providers[0].offerTypes = ['rent'], value => value.providers[0].offerTypes = ['free', 'free'],
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

const legacy = () => {
  const defaults = defaultProviderHomes();
  return { version: 1, enabled: defaults.enabled, title: defaults.title, placement: defaults.placement,
    providers: defaults.providers.slice(0, 6).map(({ id, enabled, hero, rows }) => ({ id, enabled, hero, rows })) };
};
test('v1 migrates names, IDs and appearance while preserving choices and appending the three UK broadcasters', () => {
  const saved = legacy(); saved.enabled = false; saved.providers.reverse(); saved.providers[0].enabled = false;
  saved.providers[1].hero = false; saved.providers[1].rows = [];
  const migrated = parseProviderHomes(saved);
  assert.equal(saved.version, 1); assert.equal(migrated.version, 2); assert.equal(migrated.enabled, false);
  assert.deepEqual(migrated.providers.slice(0, 6).map(({ id, enabled, hero, rows }) => ({ id, enabled, hero, rows })), saved.providers);
  assert.deepEqual(migrated.providers.slice(6).map(provider => provider.id), ['bbc', 'itvx', 'channel4']);
  for (const provider of migrated.providers.slice(6)) {
    assert.deepEqual(provider.offerTypes, ['free', 'ads']); assert.deepEqual(provider.rows.map(row => row.source), ['movies', 'shows']);
  }
  assert.deepEqual(parseProviderHomes({ ...saved, providers: [] }).providers, []);
  assert.deepEqual(defaultProviderConfig('now').movieProviderIds, [591]); assert.deepEqual(defaultProviderConfig('now').showProviderIds, [39]);
  assert.deepEqual(parseProviderHomes(migrated), migrated); // migration appends once only
});
test('custom services preserve exact user definitions and ID limits without borrowing built-in catalogue membership', () => {
  const custom = defaultCustomProvider('custom-local-service'); assert.equal(custom.name, 'New service');
  assert.deepEqual(custom.rows, []); assert.deepEqual(custom.movieProviderIds, []); assert.deepEqual(custom.showProviderIds, []);
  const settings = defaultProviderHomes(); settings.tileScale = 150; settings.showNames = false;
  custom.name = 'My archive'; custom.logoUrl = 'https://example.com/logo.png?size=300'; custom.accent = '#ABCDEF';
  custom.movieProviderIds = [1, 1000000]; custom.showProviderIds = [2]; custom.offerTypes = ['free', 'ads'];
  settings.providers = [custom]; assert.deepEqual(parseProviderHomes(settings), settings);
  const copy = cloneProviderHomes(settings); copy.providers[0].movieProviderIds.push(4); copy.providers[0].offerTypes.pop();
  assert.deepEqual(settings.providers[0].movieProviderIds, [1, 1000000]); assert.equal(settings.providers[0].offerTypes.length, 2);
  assert.equal(validProviderId('custom-' + 'x'.repeat(57)), true);
  for (const id of ['custom-', 'custom-' + 'x'.repeat(58), 'custom-UPPER', 'custom_a', '../netflix', 'unknown', 'custom-x\n']) assert.equal(validProviderId(id), false, id);
  settings.providers = Array.from({ length: maxProviders }, (_, i) => defaultCustomProvider(`custom-${i}`));
  assert.deepEqual(parseProviderHomes(settings), settings);
  settings.providers.push(defaultCustomProvider('custom-overflow')); assert.throws(() => parseProviderHomes(settings), /invalid/);
  assert.throws(() => defaultCustomProvider('netflix'), /Invalid/);
});
