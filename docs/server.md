# Install TV Item Layout on Jellyfin

TV Item Layout is an independent server plugin that loads the bundled client into **Jellyfin Web**. The layout follows the web client's TV display mode. Native clients that do not load the server's Jellyfin Web assets cannot use this plugin.

The integration is adapted from [InPlayerEpisodePreview-TV](https://github.com/jampez77/InPlayerEpisodePreview-TV). It has a separate name, assembly, API route, and plugin ID (`1a06b74f-7609-4af9-899d-430c9b5a52b1`), so it can be installed alongside that plugin. The inherited MIT notice is included in every archive.

## Install from the catalogue

1. In **Dashboard → Plugins → Repositories**, add **TV Item Layout** with this URL:

   ```text
   https://raw.githubusercontent.com/jampez77/Jellyfin-TV-Item-Layout/main/manifest.json
   ```

2. Add the **File Transformation** repository from its [installation instructions](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation#installation): `https://www.iamparadox.dev/jellyfin/plugins/manifest.json`.
3. From the catalogue, install **TV Item Layout** and **File Transformation**, choosing versions compatible with your server. File Transformation is a separate dependency and is not installed automatically. If it is already installed, keep the compatible version.
4. Restart Jellyfin. Check Dashboard → Plugins for **TV Item Layout**. The server log should contain `TV Item Layout registered with File Transformation`.
5. Reload Jellyfin Web, then select **TV** display mode in your user's display settings. Fully close and reopen a web-based TV app to clear its loaded client. Open a movie, series, or Live TV item.

The [v0.1.5 release](https://github.com/jampez77/Jellyfin-TV-Item-Layout/releases/tag/v0.1.5) adds matching TV Shows library browsing, hides native controls beneath theme videos, and fits guide artwork above the schedule without excessive cropping. Choose a plugin version that matches your Jellyfin server:

| Jellyfin server | TV Item Layout version |
| --- | --- |
| 10.10.7 | `0.1.5.1` |
| 10.11.x | `0.1.5.2` |
| 12.x | `0.1.5.3` |

The repository lists all three targets and Jellyfin filters them by server compatibility. Physical remotes and real-server playback still need installation testing.

If TV Item Layout is already installed, update it from the catalogue, restart Jellyfin, and fully reopen the client. On Jellyfin 12 the new plugin version is **0.1.5.3**. In TV display mode, **Live TV** now opens our guide at `web/#/livetv?collectionType=livetv`, and **Channels & guide** on channel details links to the same page. Desktop and mobile layouts retain Jellyfin's normal pages.

Theme videos use Jellyfin’s existing background player and follow its theme-video preference. If there is no playable theme video, the static backdrop remains. Collections list actual membership and open styled collection pages. The Collections library, explicit BoxSet list, and Movies → Collections tab also use the new layout. The Movies and TV Shows libraries also use the new style, including Jellyfin suggestions, favourites, genres, search and A–Z/# browsing. Native Upcoming, Networks and Episodes TV routes remain available through Jellyfin. Unrelated library lists and unsupported URL filters retain their native pages.

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

The script builds the client first, embeds it in the plugin DLL, and creates ZIP files and SHA-256 checksums in `dist/releases/`. Release `0.1.5` uses the target-specific plugin versions above. The target labels describe the Jellyfin API packages compiled against; test on your actual server before relying on a different patch release. Compilation alone does not establish compatibility with every client or server configuration.

## Install manually

1. In Dashboard → Plugins → Repositories, add the repository from the [File Transformation installation instructions](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation#installation): `https://www.iamparadox.dev/jellyfin/plugins/manifest.json`.
2. Install **File Transformation** from the catalogue, choosing a release compatible with your Jellyfin version.
3. Download the matching archive from the [release assets](https://github.com/jampez77/Jellyfin-TV-Item-Layout/releases/tag/v0.1.5). Stop Jellyfin. Create a folder named for the matching plugin version, such as `TV Item Layout_0.1.5.3` for Jellyfin 12, inside your server's configured `plugins` directory and extract the ZIP into it. Keep the DLL directly inside this new folder. Common plugin locations are `/config/plugins` for the official container and `/var/lib/jellyfin/plugins` for a Linux package installation; use the location belonging to your installation.
4. Start Jellyfin. Check Dashboard → Plugins for **TV Item Layout**. The server log should contain `TV Item Layout registered with File Transformation`.
5. Reload Jellyfin Web, then select the TV display mode in your user's display settings. Open a movie, series, or Live TV item.

## If automatic injection is unavailable

TV Item Layout never modifies Jellyfin's installed web files itself. When a compatible File Transformation plugin is unavailable, it logs a warning and leaves the client script endpoint available.

An administrator who already maintains a custom web client or HTML injection setup can explicitly add the following element immediately before `</body>` in Jellyfin Web's `index.html`:

```html
<script data-tv-item-layout="true" defer src="/TvItemLayout/ClientScript"></script>
```

If the Jellyfin base URL is `/jellyfin`, use `src="/jellyfin/TvItemLayout/ClientScript"`. A web client hosted on another origin needs the correct server origin in this URL. The unversioned endpoint revalidates its ETag on each load. File Transformation injection adds a content-derived version automatically, allowing immutable caching until the embedded bundle changes.

Keep a backup before making a manual HTML change. Reapply it after replacing the web client, and remove it during uninstallation. Custom CSS alone cannot load this JavaScript.

## Verify or troubleshoot

The server checks start a temporary loopback HTTP host to verify script delivery, cache headers, conditional requests, and HTML injection. They require the .NET 9 runtime and the built client:

```sh
npm run build
dotnet run --project server/verification/TvItemLayout.ServerChecks.csproj --configuration Release
```

They do not start a Jellyfin server or establish native client compatibility.


- Open `<server base URL>/TvItemLayout/ClientScript`. It should return JavaScript with content type `application/javascript`. This static asset is intentionally public; library data and playback still use Jellyfin's authenticated APIs.
- If the endpoint returns 404, check the plugin DLL location, installed target version, and startup logs, then restart Jellyfin.
- If the endpoint works but the layout does not appear, inspect the served web `index.html` for `data-tv-item-layout`. The scheduled task **TV Item Layout startup** can retry registration after File Transformation is available.
- Clear the browser's stored cache or fully close and reopen the web client after replacing the plugin. For a custom Content Security Policy, allow the script's origin.
- The plugin changes media detail views and the main Live TV page in the web TV layout. Native Android TV, Roku, and other clients with their own UI are outside this integration.

To uninstall, remove **TV Item Layout** through Dashboard → Plugins and restart, or stop Jellyfin and remove its versioned `TV Item Layout_…` plugin folder manually. Reload the web client and remove any manually inserted script tag. File Transformation can remain installed for other plugins.
