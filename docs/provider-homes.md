# Provider Home pages

The **Streaming services** row on Home opens a separate Cinema page for Netflix, Prime Video, Disney+, Apple TV+, NOW or Paramount+. Its logo and name identify the page throughout. Each page starts with featured artwork and separate **Trending films**, **Trending TV shows**, **Films** and **TV shows** rows.

These pages browse titles already in your Jellyfin library and permitted for the current account. They do not sign into a streaming subscription, fetch missing media or play a provider's stream. Opening a title uses Cinema's existing details and Jellyfin playback. **View all** or a section button opens that row as a grid; **Load more** continues beyond the first page. Back restores the previous page and selected item.

## Configure the pages

Open **Settings → Cinema → Streaming services** in Jellyfin Web's TV or desktop layout. Editing controls stay in Settings, away from Home and the provider pages.

1. Select **Home row** to change its title, hide/show it, place it before a native Home section or at the end, and arrange or hide individual services. Visit Home once if its native sections are not yet listed. An unavailable saved section falls back to the end.
2. Select a provider to enable or hide its featured artwork and arrange its rows. Select one row to edit it in the workspace.
3. Set the title, visibility, content source, optional collection override, item order and **Show rank artwork**. Add or remove rows as needed, up to 12 per provider.
4. Review the tile or content-row preview, then choose **Save changes**. Back leaves without saving the draft.

Available content sources are **Films**, **TV shows**, **Trending films**, **Trending TV shows** and **Collection**. A Collection row needs a chosen collection before it can be saved while enabled. It can contain films and TV series. Collection overrides on a Films/TV source retain that source's media-type filter.

**Source order** preserves the order of a collection, including a chart collection. Automatic catalogue rows use title order for this option. Other choices are title A–Z, title Z–A, newest release year and oldest release year. Rank artwork is a numbered image beside each poster, starting at 1 in the displayed order. Reordering or ranking a row does not change the underlying Jellyfin collection or supply a new popularity score.

Choices sync through Jellyfin for the signed-in account. Home and open provider pages check for settings changes every minute while visible and when the app regains focus. Provider pages update changed rows and featured artwork while preserving a still-valid selection. Native Home choices and **Collections → Customize collection rows** remain separate. A conflicting save keeps your draft visible and offers **Reload saved settings**; reloading replaces the draft with the server copy. Opening Settings or Home on a fresh device does not write default settings over an existing account configuration.

## Where the content comes from

| Row source | Data | Scope and order |
| --- | --- | --- |
| Automatic Films / TV shows | JustWatch subscription availability through TMDB | All matching, permitted library titles with usable TMDB IDs; sorted by your row preference |
| Automatic Trending films / Trending TV shows | Existing UK chart collections maintained by SmartLists/MDBList | Library matches from the weekly top-20 chart; source-relative order when **Source order** is selected |
| Collection or collection override | Your selected Jellyfin collection | Its permitted film/series members, with your chosen display order |

Automatic availability uses the **United Kingdom** (`GB`) and subscription (`flatrate`) offers. Rental, purchase and standalone free offers are excluded. NOW uses NOW Cinema for films and NOW for shows. Membership is checked from availability data, not inferred from studios, production networks or a title's presence in a trending list. A title may legitimately appear under more than one provider.

Cinema reads the TMDB IDs already attached to library movies and series and checks their watch-provider data on the server. It reuses the installed Jellyfin TMDB integration, including its configured key when present. There is no Cinema browser API-key field. The key stays on the server; movie/TV TMDB IDs are sent to TMDB for these requests. Cinema does not send Jellyfin user IDs, media file paths or watch history as part of those lookups.

Successful results, including confirmed absence from a service, are cached on the server for **seven days** and shared across provider pages. The first visit queues missing lookups and displays **Checking UK availability…** while matches arrive. Later visits reuse that cache. A new library title is included after its metadata ID has been checked; an older title's changed streaming availability appears after its cache entry becomes eligible for refresh. Existing results remain available when an upstream refresh fails.

Provider rows link to their source. The catalogue credit links to [JustWatch UK](https://www.justwatch.com/uk); automatic chart rows link to the provider-filtered weekly MDBList chart. The [UK platform trending guide](platform-trending.md#source-urls) lists all twelve chart URLs and the SmartLists setup.

### Automatic trending collection names

Cinema recognises the following names, ignoring punctuation, spacing and letter case:

| Provider | Films collection | TV collection |
| --- | --- | --- |
| Netflix | Netflix — Trending Movies (UK) | Netflix — Trending Shows (UK) |
| Prime Video | Prime Video — Trending Movies (UK) | Prime Video — Trending Shows (UK) |
| Disney+ | Disney+ — Trending Movies (UK) | Disney+ — Trending Shows (UK) |
| Apple TV+ | Apple TV+ — Trending Movies (UK) | Apple TV+ — Trending Shows (UK) |
| NOW | NOW — Trending Movies (UK) | NOW — Trending Shows (UK) |
| Paramount+ | Paramount+ — Trending Movies (UK) | Paramount+ — Trending Shows (UK) |

If your names have extra prefixes/suffixes, or two visible collections match the same automatic name, choose the intended **Collection override** in Settings. Cinema does not pick an ambiguous collection. You can also select any ordinary film/series collection without SmartLists or MDBList.

SmartLists controls when chart collections refresh. A Jellyfin library scan alone does not update them. With the documented SmartLists setup, wait for the staggered daily refresh or refresh the relevant list individually while SmartLists is idle. Cinema then reads the updated members. The automatic row preserves source-relative order but its number artwork counts visible library matches as **1, 2, 3…**; it does not preserve gaps from the original twenty source positions.

## Loading, missing titles and errors

| What the page shows | Meaning and next step |
| --- | --- |
| **Checking UK availability…** | Initial or newly required metadata lookups are queued. The page checks progress automatically; large libraries take longer. |
| **No matching titles in your library.** | The loaded source has no permitted matches. A streaming service's external catalogue can include many titles you do not own. |
| **Library titles need TMDB metadata…** | Some movies or series lack usable TMDB IDs. Correct/identify their Jellyfin metadata, then revisit the provider page. |
| **UK availability is temporarily unavailable.** | The server cannot currently provide availability. Check its installed TMDB integration and connectivity; this is not confirmation of an empty catalogue. |
| **Some availability could not be refreshed…** | Previously known matches remain visible while a refresh is unavailable. Requests retry with backoff. |
| **The trending collection is unavailable for this account.** | No unique automatic collection match is visible, or the source is unconfigured. Choose a collection override or check the SmartLists source and account access. |
| **This row could not be loaded.** / **could not refresh** | The row request failed. Use **Retry**; existing results remain visible when available. |

The installed server plugin and client bundle must both include provider support. If Settings reports **Update Jellyfin Cinema**, update the matching server package, restart Jellyfin and fully close/reopen the web client. See [server installation and provider troubleshooting](server.md#provider-home-data-and-settings).

Provider marks and the TMDB logo are attributed in [provider asset credits](../assets/providers/README.md). This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming availability is supplied by JustWatch.
