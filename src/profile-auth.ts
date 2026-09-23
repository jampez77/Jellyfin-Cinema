export type PublicProfile = { Id: string; Name: string; HasPassword: boolean; PrimaryImageTag?: string };
type AuthenticationResult = { User?: { Id?: string }; AccessToken?: string; ServerId?: string };
type NativeAuthClient = {
  getCurrentUserId(): string; serverId(): string;
  getPublicUsers(): Promise<PublicProfile[]>;
  getUserImageUrl?(id: string, options: Record<string, string | number>): string;
  getUrl(path: string): string;
  ajax(request: { type: 'POST'; url: string; data: string; dataType: 'json'; contentType: 'application/json' }): Promise<AuthenticationResult>;
  onAuthenticated?: (client: NativeAuthClient, result: AuthenticationResult) => Promise<unknown>;
};
type NativeAuthDashboard = {
  logout(): void; navigate(route: string): unknown;
  onServerChanged?(id: string, accessToken: string, client: NativeAuthClient): void;
};
export type ProfileSession = { client: NativeAuthClient; dashboard: NativeAuthDashboard; userId: string; serverId: string };
export type ProfileSwitchPhase = 'checking' | 'signing-out' | 'signing-in' | 'opening';
export class ProfileLoginRequired extends Error {}
const identity = (id: string) => /^[\da-f]{32}$|^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) ? id.replace(/-/g, '').toLowerCase() : id;
const loginRoute = () => /^#\/?(?:login|selectserver)\/?(?:\?|$)/i.test(window.location.hash);
const abort = () => new DOMException('Profile switching was cancelled.', 'AbortError');
// Native logout and session adoption cannot be cancelled. Keep this lock even
// if the owning view is destroyed so a retry cannot overtake their callbacks.
let switching = false;
export const profileSwitchPending = () => switching;

export async function openProfileLogin(session: ProfileSession): Promise<void> {
  if (switching) throw new Error('Jellyfin is still finishing the previous profile switch.');
  check(session);
  switching = true;
  try { await signOut(session, new AbortController().signal); }
  finally { switching = false; }
}

export function profileSession(): ProfileSession | null {
  const host = window as Window & { ApiClient?: NativeAuthClient; Dashboard?: NativeAuthDashboard };
  const client = host.ApiClient, dashboard = host.Dashboard;
  if (typeof client?.getCurrentUserId !== 'function' || typeof client.serverId !== 'function'
    || typeof client.getPublicUsers !== 'function' || typeof client.getUrl !== 'function' || typeof client.ajax !== 'function'
    || typeof client.onAuthenticated !== 'function' || typeof dashboard?.logout !== 'function'
    || typeof dashboard.navigate !== 'function' || typeof dashboard.onServerChanged !== 'function') return null;
  const userId = client.getCurrentUserId(), serverId = client.serverId();
  return userId && serverId ? { client, dashboard, userId, serverId } : null;
}
export function sameProfileServer(session: ProfileSession): boolean {
  const host = window as Window & { ApiClient?: NativeAuthClient; Dashboard?: NativeAuthDashboard };
  return host.ApiClient === session.client && host.Dashboard === session.dashboard && session.client.serverId() === session.serverId;
}
export function sameProfileSession(session: ProfileSession): boolean {
  return sameProfileServer(session) && identity(session.client.getCurrentUserId()) === identity(session.userId);
}
function check(session: ProfileSession, signal?: AbortSignal): void {
  if (signal?.aborted || !sameProfileSession(session)) throw abort();
}
export async function publicProfiles(session: ProfileSession, signal?: AbortSignal): Promise<PublicProfile[]> {
  check(session, signal);
  const users = await session.client.getPublicUsers();
  check(session, signal);
  if (!Array.isArray(users)) throw new Error('Jellyfin could not load its public profiles. Try again.');
  return users.filter(user => typeof user?.Id === 'string' && !!user.Id && typeof user.Name === 'string' && !!user.Name)
    .map(user => ({ Id: user.Id, Name: user.Name, HasPassword: user.HasPassword !== false,
      ...(typeof user.PrimaryImageTag === 'string' ? { PrimaryImageTag: user.PrimaryImageTag } : {}) }));
}
export function profileImage(session: ProfileSession, profile: PublicProfile): string | undefined {
  if (!profile.PrimaryImageTag || !session.client.getUserImageUrl) return;
  try { return session.client.getUserImageUrl(profile.Id, { type: 'Primary', width: 240, tag: profile.PrimaryImageTag }); } catch { return; }
}

/** Dashboard.logout is intentionally void. Its login/server navigation happens
 * after ServerConnections.logout, query-cache clearing and native view reset.
 * Wait for that transition; authenticating earlier could log out the new user. */
function signOut(session: ProfileSession, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = window.location.hash;
    let arrived = false, invalid = false, finished = false;
    const cleanup = () => {
      window.removeEventListener('hashchange', changed); window.removeEventListener('popstate', changed);
      document.removeEventListener('viewshow', changed, true);
      window.clearInterval(poll);
    };
    const finish = (error?: unknown) => { if (finished) return; finished = true; cleanup(); if (error) reject(error); else resolve(); };
    const inspect = () => {
      const userId = session.client.getCurrentUserId();
      invalid ||= signal.aborted || !sameProfileServer(session)
        || !!userId && identity(userId) !== identity(session.userId)
        || window.location.hash !== start && !loginRoute();
      // Aborting only cancels the later sign-in. Native logout still owns an
      // unabortable cleanup callback; wait for its completed navigation before
      // releasing the lock. Its transport also owns the network timeout.
      if (arrived && loginRoute() && !userId) finish(invalid ? abort() : undefined);
    };
    const changed = () => { if (loginRoute() && window.location.hash !== start) arrived = true; inspect(); };
    const poll = window.setInterval(inspect, 100);
    window.addEventListener('hashchange', changed); window.addEventListener('popstate', changed);
    document.addEventListener('viewshow', changed, true);
    try { check(session, signal); session.dashboard.logout(); changed(); } catch (error) { finish(error); }
  });
}

export async function switchPublicProfile(session: ProfileSession, profileId: string, signal: AbortSignal,
  phase: (value: ProfileSwitchPhase) => void): Promise<void> {
  if (switching) throw new Error('Jellyfin is still finishing the previous profile switch.');
  switching = true;
  try { await performSwitch(session, profileId, signal, phase); }
  finally { switching = false; }
}

async function performSwitch(session: ProfileSession, profileId: string, signal: AbortSignal,
  phase: (value: ProfileSwitchPhase) => void): Promise<void> {
  const start = window.location.hash;
  phase('checking');
  const users = await publicProfiles(session, signal);
  if (window.location.hash !== start) throw abort();
  const profile = users.find(user => identity(user.Id) === identity(profileId));
  if (!profile || profile.HasPassword) throw new ProfileLoginRequired('That profile needs Jellyfin’s login screen. Its password and access rules still apply.');
  if (identity(profile.Id) === identity(session.userId)) return;
  check(session, signal);
  phase('signing-out');
  await signOut(session, signal);
  if (signal.aborted || !sameProfileServer(session) || !loginRoute() || session.client.getCurrentUserId()) throw abort();
  phase('signing-in');
  // Use ApiClient's exact native authentication request, but defer its existing
  // onAuthenticated hook until the response is still current. Calling the
  // convenience authenticateUserByName method would persist credentials before
  // a cancelled/late response could be checked. The native hook alone owns
  // session persistence; Cinema keeps no passwords or saved-account tokens.
  const result = await session.client.ajax({ type: 'POST', url: session.client.getUrl('Users/authenticatebyname'),
    data: JSON.stringify({ Username: profile.Name, Pw: '' }), dataType: 'json', contentType: 'application/json' });
  if (signal.aborted || !sameProfileServer(session) || !loginRoute() || session.client.getCurrentUserId()) throw abort();
  if (typeof result?.User?.Id !== 'string' || identity(result.User.Id) !== identity(profile.Id)
    || typeof result.ServerId !== 'string' || identity(result.ServerId) !== identity(session.serverId)
    || typeof result.AccessToken !== 'string' || !result.AccessToken.trim()) {
    throw new Error('Jellyfin returned a different profile. Please sign in again.');
  }
  phase('opening');
  await session.client.onAuthenticated!(session.client, result);
  if (signal.aborted || !sameProfileServer(session) || !loginRoute() || identity(session.client.getCurrentUserId()) !== identity(profile.Id)) throw abort();
  session.dashboard.onServerChanged!(profile.Id, result.AccessToken, session.client);
  await session.dashboard.navigate('home');
}
