import test from 'node:test';
import assert from 'node:assert/strict';
import { currentUserAccount, isCurrentUserAdministrator, sameUserAccount } from '../src/current-user-policy';

const originalWindow = globalThis.window;
test.afterEach(() => { globalThis.window = originalWindow; });
function setup() {
  const state = { user: '12345678123412341234123456789abc', server: 'server-one', admin: true, calls: [] as string[], cachedReads: 0 };
  const client = { getCurrentUserId: () => state.user, serverId: () => state.server,
    getCurrentUser: async () => { state.cachedReads++; return { Id: state.user, Policy: { IsAdministrator: true } }; },
    getUser: async (id: string) => { state.calls.push(id); return { Id: state.user, Policy: { IsAdministrator: state.admin } }; } };
  globalThis.window = { ApiClient: client } as unknown as Window & typeof globalThis;
  return { state, client };
}

test('administrator actions require a fresh strict policy for the actual current account', async () => {
  const { state, client } = setup();
  assert.equal(await isCurrentUserAdministrator(), true); assert.deepEqual(state.calls, [state.user]);
  state.admin = false; assert.equal(await isCurrentUserAdministrator(), false);
  assert.equal(state.cachedReads, 0, 'Never use the SDK cached administrator policy after revocation');
  client.getUser = async () => ({ Id: 'different-user', Policy: { IsAdministrator: true } });
  assert.equal(await isCurrentUserAdministrator(), false);
  client.getUser = async () => ({ Id: state.user, Policy: { IsAdministrator: 'true' as unknown as boolean } });
  assert.equal(await isCurrentUserAdministrator(), false);
});

test('same account GUID formatting is accepted and missing/error responses fail closed', async () => {
  const { client } = setup();
  client.getUser = async () => ({ Id: '12345678-1234-1234-1234-123456789ABC', Policy: { IsAdministrator: true } });
  assert.equal(await isCurrentUserAdministrator(), true);
  client.getUser = async () => { throw new Error('offline'); };
  assert.equal(await isCurrentUserAdministrator(), false);
  globalThis.window = {} as Window & typeof globalThis;
  assert.equal(currentUserAccount(), null); assert.equal(await isCurrentUserAdministrator(), false);
});

for (const change of ['user', 'server', 'client'] as const) {
  test(`a delayed policy for an outgoing ${change} cannot authorize the new account`, async () => {
    const { state, client } = setup(); const account = currentUserAccount();
    let finish!: (value: { Id: string; Policy: { IsAdministrator: boolean } }) => void;
    client.getUser = () => new Promise(resolve => { finish = resolve; });
    const pending = isCurrentUserAdministrator(account), id = state.user;
    if (change === 'client') globalThis.window = { ApiClient: { ...client } } as unknown as Window & typeof globalThis;
    else state[change] = 'changed';
    assert.equal(sameUserAccount(account), false);
    finish({ Id: id, Policy: { IsAdministrator: true } }); assert.equal(await pending, false);
  });
}
