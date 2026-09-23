type NativeUser = { Id?: string; Policy?: { IsAdministrator?: boolean } };
type NativeUserClient = {
  getCurrentUserId(): string;
  serverId?(): string;
  getUser(id: string): Promise<NativeUser>;
};
export type CurrentUserAccount = { client: NativeUserClient; userId: string; serverId: string };
const identity = (id: string) => /^[\da-f]{32}$|^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) ? id.replace(/-/g, '').toLowerCase() : id;

export function currentUserAccount(): CurrentUserAccount | null {
  const client = (window as Window & { ApiClient?: NativeUserClient }).ApiClient;
  if (typeof client?.getCurrentUserId !== 'function' || typeof client.getUser !== 'function') return null;
  const userId = client.getCurrentUserId();
  return userId ? { client, userId, serverId: client.serverId?.() || '' } : null;
}

export function sameUserAccount(account: CurrentUserAccount | null): boolean {
  const current = currentUserAccount();
  return !!account && !!current && account.client === current.client && account.serverId === current.serverId
    && identity(account.userId) === identity(current.userId);
}

/** Read the signed-in user's fresh policy, never the profile being edited.
 * A link is convenience only; Jellyfin still enforces administrator access. */
export async function isCurrentUserAdministrator(account = currentUserAccount()): Promise<boolean> {
  if (!account || !sameUserAccount(account)) return false;
  try {
    // getCurrentUser(false) still returns the SDK's in-memory _currentUser.
    // getUser(id) goes directly to the authenticated Users/{id} endpoint.
    const user = await account.client.getUser(account.userId);
    return sameUserAccount(account) && typeof user?.Id === 'string' && identity(user.Id) === identity(account.userId)
      && user.Policy?.IsAdministrator === true;
  } catch { return false; }
}
