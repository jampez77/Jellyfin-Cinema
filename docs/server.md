# Install Jellyfin Cinema on Jellyfin

Jellyfin Cinema, formerly TV Item Layout, is an independent server plugin that loads the bundled client into **Jellyfin Web**. The layout activates in the web client's TV and desktop display modes; mobile retains its native pages. Native clients that do not load the server's Jellyfin Web assets cannot use this plugin.

The current prerelease is **0.2.10**, available through the catalogue and manual downloads below. It fixes the empty Home-settings response under Jellyfin’s JSON configuration so first-use migration and collection editing can complete. Background sync on Home now retries silently. This release still needs installation and physical-TV testing.

The integration is adapted from [InPlayerEpisodePreview-TV](https://github.com/jampez77/InPlayerEpisodePreview-TV). It has a separate name, assembly, API route, and plugin ID (`1a06b74f-7609-4af9-899d-430c9b5a52b1`), so it can be installed alongside that plugin. The inherited MIT notice is included in every archive.

Jellyfin Cinema retains TV Item Layout’s plugin ID, `Jellyfin.Plugin.TvItemLayout.dll`, API endpoints, script and archive filenames. Its new public repository is [jampez77/Jellyfin-Cinema](https://github.com/jampez77/Jellyfin-Cinema). Existing users must replace the old catalogue repository entry with the new URL below, then update normally without uninstalling the plugin. The new catalogue starts at 0.2.0; historical releases are not included in this catalogue.

## Install from the catalogue

1. In **Dashboard → Plugins → Repositories**, add **Jellyfin Cinema** with this URL:

   ```text
   https://raw.githubusercontent.com/jampez77/Jellyfin-Cinema/main/manifest.json
   ```

2. Add the **File Transformation** repository from its [installation instructions](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation#installation): `https://www.iamparadox.dev/jellyfin/plugins/manifest.json`.
3. From the catalogue, install the compatible build of **Jellyfin Cinema** and **File Transformation**. File Transformation is a separate dependency and is not installed automatically. If it is already installed, keep the compatible version.
4. Restart Jellyfin. Check Dashboard → Plugins for **Jellyfin Cinema**. The server log should contain `Jellyfin Cinema registered with File Transformation`.
5. Reload Jellyfin Web, using **Desktop** or **TV** display mode in your user's display settings. Fully close and reopen a web-based TV app to clear its loaded client. Open a movie, series, or Live TV item.

Choose the build from the [v0.2.10 prerelease](https://github.com/jampez77/Jellyfin-Cinema/releases/tag/v0.2.10) that matches your Jellyfin server:

| Jellyfin server | Jellyfin Cinema version |
| --- | --- |
| 10.10.7 | `0.2.10.1` |
| 10.11.x | `0.2.10.2` |
| 12.x | `0.2.10.3` |

The repository lists all three targets and Jellyfin filters them by server compatibility. This is a server-testing prerelease. Physical Mac mini/TV deployment, remote controls and real-server playback have not been tested by this release work.

If a newly published version is missing, Jellyfin 12’s dashboard can reuse its [cached catalogue for 15 minutes](https://github.com/jellyfin/jellyfin-web/blob/v12.0/src/apps/dashboard/features/plugins/api/usePackages.ts#L19-L25), even after a page reload. Leave and reopen **Catalogue** after that interval. To refresh immediately, remove only the **Jellyfin Cinema repository entry** from **Repositories**, then add it again using the same catalogue URL above. This refreshes the listing without uninstalling the plugin or clearing your Home row preferences.

If TV Item Layout is already installed, open **Dashboard → Plugins → Repositories** and replace the old TV Item Layout catalogue entry with the Jellyfin Cinema URL above. Update the existing plugin to the matching 0.2.10 build, restart Jellyfin and fully reopen the client. Do not uninstall it or add a second copy: the unchanged GUID identifies the update. In TV and desktop display modes, **Live TV** opens our guide at `web/#/livetv?collectionType=livetv`, and **Channels & guide** on channel details links to the same page. Mobile layouts retain Jellyfin's normal pages.

Theme videos use Jellyfin’s existing background player and follow its theme-video preference. If there is no playable theme video, the static backdrop remains. Collections list actual membership and open styled collection pages. The Collections library, explicit BoxSet list, and Movies → Collections tab also use the new layout. The Movies and TV Shows libraries also use the new style, including Jellyfin suggestions, favourites, genres, search and A–Z/# browsing. Native Upcoming, Networks and Episodes TV routes remain available through Jellyfin. Unrelated library lists and unsupported URL filters retain their native pages.

Movie and episode details show **Ends at** beside the ratings when a usable runtime is available. The estimate uses the current local clock plus the remaining runtime for **Resume**, or the full runtime when **Play** starts a watched title from the beginning. It updates when its displayed finish minute changes. The series hero uses its selected episode’s duration and playback position.

## Build a matching archive

Install the repository's Node dependencies and a .NET SDK that supports the selected target. Run from the repository root:

```sh
npm ci
bash scripts/package-plugin.sh 10.11.0
```

| Jellyfin server | Build argument | Framework |
| --- | --- | --- |
| 10.10.7 | `10.10.7` | .NET 8 |
| 10.11.x | `10.11.0` (default) | .NET 9 |
| 12.x | `12.0.0` | .NET 10 |

To compile all three baseline targets and preserve their archives in a single run:

```sh
bash scripts/package-plugin.sh all
```

The script builds the client first, embeds it in the plugin DLL, and creates ZIP files and SHA-256 checksums in `dist/releases/`. The published packages and this source tree use `0.2.10.1` for Jellyfin 10.10.7, `0.2.10.2` for 10.11.x and `0.2.10.3` for 12.x. The target labels describe the Jellyfin API packages compiled against; test on your actual server before relying on a different patch release. Compilation alone does not establish compatibility with every client or server configuration.

## Install manually

1. In Dashboard → Plugins → Repositories, add the repository from the [File Transformation installation instructions](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation#installation): `https://www.iamparadox.dev/jellyfin/plugins/manifest.json`.
2. Install **File Transformation** from the catalogue, choosing a release compatible with your Jellyfin version.
3. Download the matching archive from the [0.2.10 release assets](https://github.com/jampez77/Jellyfin-Cinema/releases/tag/v0.2.10), or use a matching local archive from `dist/releases/`. Stop Jellyfin. Extract the ZIP into a versioned folder inside your server's configured `plugins` directory, such as `TV Item Layout_0.2.10.3` for Jellyfin 12. Keep the DLL directly inside this folder and replace the previous version when upgrading manually. Common plugin locations are `/config/plugins` for the official container and `/var/lib/jellyfin/plugins` for a Linux package installation; use the location belonging to your installation.
4. Start Jellyfin. Check Dashboard → Plugins for **Jellyfin Cinema** and the File Transformation registration message.
5. Reload Jellyfin Web, using Desktop or TV display mode in your user's display settings. Open a movie, series, or Live TV item.

## If automatic injection is unavailable

Jellyfin Cinema never modifies Jellyfin's installed web files itself. When a compatible File Transformation plugin is unavailable, it logs a warning and leaves the client script endpoint available.

An administrator who already maintains a custom web client or HTML injection setup can explicitly add the following element immediately before `</body>` in Jellyfin Web's `index.html`:

```html
<script data-tv-item-layout="true" defer src="/TvItemLayout/ClientScript"></script>
```

If the Jellyfin base URL is `/jellyfin`, use `src="/jellyfin/TvItemLayout/ClientScript"`. A web client hosted on another origin needs the correct server origin in this URL. The unversioned endpoint revalidates its ETag on each load. File Transformation injection adds a content-derived version automatically, allowing immutable caching until the embedded bundle changes.

Keep a backup before making a manual HTML change. Reapply it after replacing the web client, and remove it during uninstallation. Custom CSS alone cannot load this JavaScript.

## Verify or troubleshoot

The server checks start a temporary loopback HTTP host to verify script delivery, cache headers, conditional requests, and HTML injection. They require the matching .NET runtime and the built client (.NET 8 for Jellyfin 10.10.7, .NET 9 for 10.11.x, .NET 10 for 12.x):

```sh
npm run build
dotnet run --project server/verification/TvItemLayout.ServerChecks.csproj --configuration Release
# To verify the Jellyfin 12 target:
dotnet run --project server/verification/TvItemLayout.ServerChecks.csproj --configuration Release -p:JellyfinVersion=12.0.0
```

They also check profile-switch eligibility and session boundaries using real version-specific Jellyfin entity types and controlled service stubs. They do not start a Jellyfin server or establish native client compatibility.


- Open `<server base URL>/TvItemLayout/ClientScript`. It should return JavaScript with content type `application/javascript`. This static asset is intentionally public; library data and playback still use Jellyfin's authenticated APIs.
- If the endpoint returns 404, check the plugin DLL location, installed target version, and startup logs, then restart Jellyfin.
- If the endpoint works but the layout does not appear, inspect the served web `index.html` for `data-tv-item-layout`. The scheduled task **Jellyfin Cinema startup** can retry registration after File Transformation is available.
- Clear the browser's stored cache or fully close and reopen the web client after replacing the plugin. For a custom Content Security Policy, allow the script's origin.
- The plugin changes media detail views and the main Live TV page in the web TV and desktop layouts. Native Android TV, Roku, and other clients with their own UI are outside this integration.

To uninstall, remove **Jellyfin Cinema** (or **TV Item Layout** on older builds) through Dashboard → Plugins and restart, or stop Jellyfin and remove its versioned plugin folder manually. Reload the web client and remove any manually inserted script tag. File Transformation can remain installed for other plugins.

## Home preferences and Featured

Home styles Jellyfin’s existing sections in place, with titles and subtitles sharing its charcoal surface. Set the native sections and their order in your normal Jellyfin Home settings; user/device overrides, library exclusions, Next up options and saved destinations remain owned by Jellyfin.

If [Jellyfin Featured](https://github.com/spkesDE/jellyfin-featured-plugin) is installed, its carousel remains in the native Home container. Jellyfin Cinema matches its colours and typography to the rest of the layout. Its display settings, height and layout, personalization, trailers and input handling remain under Featured’s control. Keep Featured enabled.

Open **Collections → Customize collection rows**. The launcher has moved from Home to the Collections page. Select a row from the row list and use its **Content**, **Item order** and **Home position** tabs in the adjacent workspace. Add a Collections row for several selected collections, or separate collection items rows for individual collections. Choose titles and optional **Ranked artwork**, then choose **Save rows**. Choose **Add collection tabs** for up to six tabs on an item row, each with an editable label, its own source collection and item order. The first tab opens by default. Use **Movies** and **Shows** tabs to keep separate collections under one row title, or choose any labels and collections that suit your library. Existing single-collection rows keep working.

**Home preview** shows the row’s title, artwork, active collection tab and selected order as you edit. Ranked rows show the same outlined number images used on Home, while position context places the draft row among your Home sections. Missing-artwork placeholders remain contained in the choice and order thumbnails, keeping the editor usable. These are unsaved changes: **Save rows** applies them and **Cancel** keeps your previous settings.

**Item order** can retain Jellyfin’s collection order, sort by title or year, or use a manual order. The change is local to that Home row and does not edit the server’s collection metadata. Number images beside posters follow this chosen order, not a popularity calculation. **Home position** places custom rows among native sections, including Featured and each library’s Latest row, while Jellyfin and Featured keep control of their own sections. Visit Home once to make its sections available in the editor. If a chosen section is hidden or unavailable, its custom row appears at the end.

Custom row settings sync through the server for the signed-in account. **After updating, open Home once in the original desktop browser to migrate its saved rows**, then reopen Home on the TV with the same account. Home also refreshes while visible every minute and on returning to the app. The server copy is authoritative, including deliberately empty rows; a fresh device cannot erase existing settings. If two editors change rows together, the later save asks you to reload saved rows before trying again. Home sync failures keep the last cached rows and retry silently, without a warning banner or Retry button. The editor still reports failed loads and saves; failed saves keep the draft open. Local storage caches the last saved rows for offline display; the standalone demo still saves locally. Existing version-1 settings are preserved: rows keep collection order and end-of-Home placement until edited. Limits are 12 rows, 40 selected collections per Collections row, 2,000 saved item IDs per manual order, and 60 displayed members per item row, followed by **View full collection** when more members are available. The complete sync request is limited to 512 KiB; unusually large combined manual orders show an error instead of being truncated. Native Home settings and Featured preferences remain separate. The authenticated `GET/PUT TvItemLayout/HomeCollections` endpoint resolves the user from the current device session, rejects API keys and uses conditional revisions to prevent stale writes. Settings are stored under the server data directory at `jellyfin-cinema/home-collections/<user-id>.json`; include this directory in server backups.

The optional [UK platform trending guide](https://github.com/jampez77/Jellyfin-Cinema/blob/main/docs/platform-trending.md) explains how SmartLists 12.0.3.0 or newer on Jellyfin 12 can maintain weekly UK JustWatch collections through MDBList. Cinema displays the matching items already in your library. It can show these as six platform rows with **Movies**/**Shows** tabs, or use any existing collections without external list plugins.

Use **Add to collection** on a media detail page to choose an existing collection or create one. This writes to Jellyfin and requires your account’s collection-management permission. Existing memberships are marked to avoid duplicate additions; successful saves refresh the item’s collection links.

## Music and recordings refinements in 0.2.1

Choose **Music → Playlists** to browse your account’s playlists, search or filter them, and open their track rows. **Play playlist** starts the complete playlist; selecting a track starts the complete queue at that entry. The saved order and repeated tracks are preserved through Jellyfin’s authenticated APIs and native playback. More tracks load through **Show more**, and Back restores the selected card and filters. Album Play buttons have extra room for their focus highlight.

Jellyfin’s native music player and Now playing queue receive a larger album-art layout, clear track details and matching queue styling; their queue actions, playback state and permissions remain native. In desktop mode, the existing compact audio bar stays accessible below Cinema’s full-page views. Its mouse controls and slider keys remain native, and the page reserves room for the visible bar. The current DVR library’s **Recordings** tile on Home uses Cinema’s recordings layout, scoped to that folder. An older recording library may remain a separate mixed-content folder after the DVR destination changes. Since 0.2.6, those folders also receive Cinema headings, controls and cards while keeping their native contents and filters. No folders are merged or redirected. Recordings’ **Schedule**, **Series recordings**, details and DVR dialogs retain Jellyfin’s scheduling, editing and permission checks.

## Search, settings and profiles

In TV and desktop modes, Search, Settings and the signed-out login page share the Cinema styling. Their native search controls, preference forms, Quick Connect and authentication behavior remain active. Mobile keeps Jellyfin’s native pages and account menu.

Select the user avatar to open **Who’s watching?** directly. Large square profile artwork, names and clear focus states make the chooser easy to use with a remote. Select the current profile or **Back** to return. **Settings**, **Use login screen**, and **Dashboard** for the signed-in administrator appear below the profile tiles. Dashboard permission is checked again when selected; Settings also includes the shortcut.

**Who’s watching?** shows Jellyfin’s public profiles. An eligible passwordless profile opens Home after Jellyfin finishes signing out the old session. Profiles marked **Sign in** and **Use login screen** open native sign-in; hidden accounts can sign in there manually. Login styling follows the saved device TV or desktop display mode even while signed out. Version 0.2.9 keeps Cinema-initiated webOS switches on the current server: native logout still clears credentials, queries and views, then its public server-selection callback opens the same server’s login route instead of unloading the web frame. Normal native logout remains unchanged.

Version 0.2.7 replaced the obsolete `HasPassword` flag, which Jellyfin 12 always reports as true, with the authenticated `TvItemLayout/ProfileSwitchEligibility` endpoint. It returns only eligible profile IDs to the current signed-in user/device session, rejects API keys and is not cached. Candidates must be visible, enabled, non-administrator accounts using Jellyfin’s default authentication provider with an empty stored password, and satisfy device/network rules. The client intersects these IDs with Jellyfin’s public users and checks again before logout. An unavailable or incompatible endpoint falls back to native sign-in. Cinema does not guess blank passwords to discover accounts, store extra credentials, or change passwords, roles or server policies.

To allow one-click switching in both directions, each viewing account must be eligible and passwordless; keep a separate password-protected administrator. An administrator can use **Dashboard → Users → account → Password → Reset Password** for a non-admin viewing account and make it visible on login screens. Do this only for accounts you intend to make passwordless. If a password or access rule changes between the check and sign-in, Jellyfin can reject the single normal authentication attempt; Cinema offers native login without retrying.

## Integrated player features

In TV and desktop display modes, press Down during video playback or choose the Browse icon to open the episode/film/channel browser. In 0.2.1 the mouse control is a compact icon with a tooltip and accessible label, without changing the native player bar’s sizing. The season selector previews that season’s first available episode without changing playback; Play/Resume starts the selected episode. Version 0.2.0 fixes Down opening the integrated preview when a standalone preview script is present but failed to initialise. Pause video to show its artwork and synopsis. Working standalone preview controls retain priority. The standalone PauseScreen plugin retains priority over the integrated pause treatment.

During live video, **ChannelUp / ChannelDown** commands and channel keys exposed by the client step through the same permitted channel order as the guide. Held repeats and pending tunes are ignored. Movies, episodes, audio, text fields and modal dialogs keep their normal controls. [LG’s key table](https://webostv.developer.lge.com/develop/guides/magic-remote) lists programme +/− as unavailable to web apps; Cinema cannot receive a key reserved by the TV. Use **Down → Channels** if your remote does not deliver it. This release does not remap Page Up/Down, which Jellyfin uses for chapter controls.

`TvItemLayout/PlaybackContext` is an authenticated, uncached read endpoint. It resolves only the request’s current user and device and returns playing identity and queue, without credentials or unrelated session data. It supports cinema intro resolution; browsing can still use the native player’s identity if this endpoint is unavailable. Native playback and user media permissions remain controlled by Jellyfin.
