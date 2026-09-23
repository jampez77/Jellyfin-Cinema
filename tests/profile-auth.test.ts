import test from 'node:test';
import assert from 'node:assert/strict';
import { openProfileLogin, profileSession, profileSwitchPending, ProfileLoginRequired, switchPublicProfile, type ProfileSwitchPhase } from '../src/profile-auth';

const originalWindow = globalThis.window, originalDocument = globalThis.document;
test.afterEach(() => { globalThis.window = originalWindow; globalThis.document = originalDocument; });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  const state = { user: 'family', server: 'server', logout: 0, auth: [] as unknown[], adopted: 0, handoff: 0, routes: [] as string[], phases: [] as ProfileSwitchPhase[] };
  const host = Object.assign(new EventTarget(), { location: { hash: '#/home' }, setInterval, clearInterval });
  const route = (hash: string) => { host.location.hash = hash; host.dispatchEvent(new Event('hashchange')); };
  const result = { User: { Id: 'child' }, ServerId: 'server', AccessToken: 'dummy-test-session' };
  const client = {
    getCurrentUserId: () => state.user, serverId: () => state.server,
    getPublicUsers: async () => [{ Id: 'family', Name: 'Family', HasPassword: false }, { Id: 'child', Name: 'Child', HasPassword: false }, { Id: 'adult', Name: 'Adult', HasPassword: true }],
    getUrl: (path: string) => 'http://example.invalid/' + path,
    ajax: async (request: unknown) => { state.auth.push(request); return result; },
    onAuthenticated: async (_client: unknown, response: typeof result) => { state.adopted++; state.user = response.User.Id; }
  };
  const finishLogout = () => { state.user = ''; route('#/login'); };
  const dashboard = { logout() { state.logout++; finishLogout(); }, navigate(value: string) { state.routes.push(value); route('#/' + value); }, onServerChanged() { state.handoff++; } };
  Object.assign(host, { ApiClient: client, Dashboard: dashboard });
  globalThis.window = host as unknown as Window & typeof globalThis;
  globalThis.document = new EventTarget() as Document;
  const session = profileSession()!; assert.ok(session);
  const controller = new AbortController();
  const start = (id = 'child') => switchPublicProfile(session, id, controller.signal, phase => state.phases.push(phase));
  return { state, client, dashboard, route, session, controller, start, finishLogout, result };
}

test('passwordless profile uses native cleanup, exact auth request and native session adoption before Home', async () => {
  const { state, start } = setup(); await start();
  assert.equal(state.logout, 1); assert.equal(state.adopted, 1); assert.equal(state.handoff, 1); assert.deepEqual(state.routes, ['home']);
  assert.deepEqual(state.phases, ['checking', 'signing-out', 'signing-in', 'opening']);
  assert.deepEqual(state.auth, [{ type: 'POST', url: 'http://example.invalid/Users/authenticatebyname', data: JSON.stringify({ Username: 'Child', Pw: '' }), dataType: 'json', contentType: 'application/json' }]);
  assert.equal(profileSwitchPending(), false);
});

test('protected, missing and unknown-password profiles require native login before any logout or auth', async () => {
  const { client, state, start } = setup();
  await assert.rejects(start('adult'), ProfileLoginRequired); await assert.rejects(start('missing'), ProfileLoginRequired);
  client.getPublicUsers = async () => [{ Id: 'child', Name: 'Child', HasPassword: undefined as unknown as boolean }];
  await assert.rejects(start(), ProfileLoginRequired);
  assert.equal(state.logout, 0); assert.deepEqual(state.auth, []);
});

for (const change of ['user', 'route', 'abort'] as const) test(`stale ${change} during discovery never signs out`, async () => {
  const { client, state, route, controller, start } = setup();
  const list = await client.getPublicUsers(), pending = deferred<typeof list>(); client.getPublicUsers = () => pending.promise;
  const work = start(); if (change === 'user') state.user = 'other'; else if (change === 'route') route('#/search'); else controller.abort();
  pending.resolve(list); await assert.rejects(work, { name: 'AbortError' }); assert.equal(state.logout, 0); assert.equal(state.adopted, 0);
});

test('void native logout must finish its login navigation before authentication', async () => {
  const { dashboard, state, start, route } = setup(); dashboard.logout = () => { state.logout++; };
  const work = start(); await tick(); assert.equal(state.logout, 1); assert.deepEqual(state.auth, []);
  state.user = ''; await tick(); assert.deepEqual(state.auth, []);
  route('#/login'); await work; assert.equal(state.adopted, 1);
});

test('aborted deferred logout retains its lock until native completion and cannot overtake a retry', async () => {
  const { dashboard, state, start, controller, finishLogout, session, route } = setup(); dashboard.logout = () => { state.logout++; };
  const work = start(); await tick(); controller.abort(); await tick();
  assert.equal(profileSwitchPending(), true);
  await assert.rejects(switchPublicProfile(session, 'child', new AbortController().signal, () => {}), /previous profile switch/);
  await assert.rejects(openProfileLogin(session), /previous profile switch/);
  assert.equal(state.logout, 1); assert.deepEqual(state.auth, []);
  finishLogout(); await assert.rejects(work, { name: 'AbortError' }); assert.equal(profileSwitchPending(), false);
  state.user = 'family'; route('#/home'); dashboard.logout = finishLogout;
  await switchPublicProfile(session, 'child', new AbortController().signal, () => {}); assert.equal(state.adopted, 1);
});

test('native-login fallback shares the pending logout lock', async () => {
  const { dashboard, state, session, start, finishLogout } = setup(); dashboard.logout = () => { state.logout++; };
  const work = openProfileLogin(session); await tick(); await assert.rejects(start(), /previous profile switch/);
  finishLogout(); await work; assert.equal(state.logout, 1); assert.deepEqual(state.auth, []); assert.equal(profileSwitchPending(), false);
});

test('server-rejected authentication leaves the signed-out native login usable', async () => {
  const { client, state, start } = setup(); client.ajax = async () => { throw new Error('401'); };
  await assert.rejects(start(), /401/); assert.equal(state.user, ''); assert.equal(window.location.hash, '#/login');
  assert.equal(state.adopted, 0); assert.deepEqual(state.routes, []); assert.equal(profileSwitchPending(), false);
});

for (const change of ['user', 'server', 'route', 'abort'] as const) test(`late authentication after ${change} cannot adopt credentials`, async () => {
  const { client, state, start, route, controller, result } = setup(); const pending = deferred<typeof result>(); client.ajax = () => pending.promise;
  const work = start(); await tick();
  if (change === 'user') state.user = 'another'; else if (change === 'server') state.server = 'other'; else if (change === 'route') route('#/search'); else controller.abort();
  pending.resolve(result); await assert.rejects(work, { name: 'AbortError' }); assert.equal(state.adopted, 0); assert.equal(state.handoff, 0); assert.deepEqual(state.routes, []);
});

test('mismatched server or user responses never reach native credential persistence', async () => {
  const { client, state, start, result, route } = setup(); client.ajax = async () => ({ ...result, ServerId: 'different-server' });
  await assert.rejects(start(), /different profile/); assert.equal(state.adopted, 0);
  state.user = 'family'; route('#/home'); client.ajax = async () => ({ ...result, User: { Id: 'other' } });
  await assert.rejects(start(), /different profile/); assert.equal(state.adopted, 0);
});

test('missing server identity and empty or malformed tokens never reach native persistence', async () => {
  const { client, state, start, result, route } = setup();
  for (const invalid of [{ ...result, ServerId: undefined }, { ...result, AccessToken: '' }, { ...result, AccessToken: '  ' }, { ...result, AccessToken: 123 }]) {
    state.user = 'family'; route('#/home'); client.ajax = async () => invalid as typeof result;
    await assert.rejects(start(), /different profile/); assert.equal(state.adopted, 0);
  }
});
