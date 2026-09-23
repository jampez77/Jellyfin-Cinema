# Jellyfin Cinema local preview

Run `npm install`, `npm run build`, and `npm run dev` from the project root. Open [the preview](http://127.0.0.1:4173/).

Add `?layout=desktop` before the hash to preview desktop mode, for example [desktop Home](http://127.0.0.1:4173/?layout=desktop&featured=0#/home). This keeps the same Cinema design without enabling Jellyfin’s TV display mode.

The preview loads the same layout bundle used by Jellyfin, with a separate in-memory API supplying fictional media. It needs no Jellyfin credentials and makes no network requests after the local page and bundled photographs have loaded. The small switcher at the top belongs only to this preview.

- **TV Shows:** browse five fictional series using search, genres, A–Z/#, favourites and native-style episode suggestions. Open North of Nowhere to try its full episode browser. North of Nowhere has three seasons and six episodes per season. The first episode is watched; the second is partially watched. Down from the last episode advances to the next season; Up from the first returns to the previous season’s last episode.
- **Movies:** the library includes search, letter filters, genres, favourites and suggestions. Open a card to view its details; After the Tide has a resume position, a trailer action, cast, technical metadata and four related films. The trailer opens its own labelled playback simulation and preserves the film’s resume position.
- **Live TV:** Four channels share a horizontal programme timeline, with varied programme durations. Left/Right browses time, Up/Down browses channels, and artwork for the highlighted programme fits above the schedule, including future programmes. The schedule is calculated when the page loads.
- **Home:** use **Collections → Customize collection rows** to choose collections, add rows of their members and enable outlined rank images beside posters. Choices persist for the demo account in this browser. The rest is a native-shaped Home fixture with My Media, Continue watching/listening, Next up, Live TV navigation and latest additions. The installed layout styles Jellyfin's existing sections in place, preserving its user preferences and plugins. The preview's fictional featured hero is labelled; it is not the Featured plugin. Native-only destinations such as settings/search are not simulated.
- **Music:** fictional albums, artists and tracks, with search, genres, A–Z/#, favourites and suggestions. Open an artist to see albums, then an album to select its tracks.
- **Recordings:** completed and active recordings, search and direct playback. Scheduling links point to Jellyfin's native pages, which the local fixture does not implement.

Movies and TV Shows start on Suggestions, with All movies/shows last. Movie/show details include **Add to collection**; demo additions and newly created collections last until page reload. Selecting a currently live programme or a channel name in the guide starts its simulated channel; upcoming programmes stay selected without playback.

The Live TV preview opens the main guide at `/#/livetv?collectionType=livetv`. Channel details remain available at `/#/details?id=channel-field`; their **Channels & guide** button links to the main guide.

Arrow keys, Enter and Escape exercise remote navigation. Clicking works too. Playback opens a clearly labelled simulation; **Back to details**, **Back to guide** or Escape returns to the previous page. Favorites remain set while the page stays open.

Use the address bar to open an item directly:

- `/#/tv?topParentId=library-tv`
- `/#/details?id=series-north`
- `/#/movies?topParentId=library-movies`
- `/#/details?id=movie-tide`
- `/#/details?id=channel-field`
- `/#/home`
- `/#/music?topParentId=library-music&collectionType=music`
- `/#/livetv?tab=3&collectionType=livetv`

## Failure and loading scenarios

Add a query before the hash and reload:

- `/?scenario=empty#/details?id=series-north`: empty seasons, episodes, related films, channels and programme listings.
- `/?scenario=empty#/details?id=movie-tide`: no trailer available, while film playback remains available.
- `/?scenario=error#/details?id=series-north`: all asynchronous API calls reject, allowing the error and retry state to be checked.
- `/?scenario=slow#/details?id=series-north`: longer, varied response times. Switch items or seasons quickly to check that older requests cannot replace the active view.

Remove the query and reload to restore ordinary behaviour. All titles, descriptions, cast names and ratings are fictional demonstration data. Photograph sources are recorded in [assets/CREDITS.md](assets/CREDITS.md).

## Native Home preferences fixture

The Home preview uses the native `#indexPage #homeTab .sections.homeSectionsContainer` structure. It keeps the native Home/Favourites tabs and navigation controls. It does not fetch or overwrite a real user's preferences.

Query parameters before the hash demonstrate different native section outputs:

- `/?featured=0#/home`: native rows without the fictional featured hero.
- `/?featured=0&homeSections=nextup,librarybuttons,resumeaudio,latestmedia#/home`: reordered sections, library buttons, and Continue listening.
- `/?featured=0&libraryOrder=library-music,library-tv,library-movies,library-live&hiddenLibraries=library-tv&hiddenLatest=library-movies#/home`: library order, a hidden library, and Movies excluded from Latest.

Supported fixture section names are `smalllibrarytiles`, `librarybuttons`, `resume`, `resumeaudio`, `nextup`, `livetv`, `activerecordings`, `latestmedia`, and `none`. As native TV Home does, the fixture adds a library section if both library section types are absent. These are fictional preview preferences only.

Browser tests can dispatch `demo-home-settings` on `document`, with a `CustomEvent` detail containing `sections`, `libraryOrder`, `hiddenLibraries`, `hiddenLatest`, or `featured`, to model native sections changing after activation. Production applies styling without replacing, cloning or moving those sections.

The ordinary preview hero uses a representative `.ec-root` solely to verify that independently owned controls survive the Home skin. The dedicated Featured browser tests disable it with `featured=0`, load the actual upstream Featured bundle and stub its server responses. No Featured source or bundle is included in this plugin or the preview installer.

## Collections and theme videos

The preview includes **Coastal Stories** for After the Tide and **Into the Wilderness** for North of Nowhere. Collection cards open the styled collection page with links to its members. The Collections preview control opens the library list at `/#/list?parentId=library-collections`. Back restores the selected card. Series overviews now scroll down to recommendations as well as collections.

Native theme-video integration is covered by browser tests using a local canvas video stream. The preview does not download or autoplay a sample theme video; installed Jellyfin clients use their existing theme player and preferences.

In-player browsing and the pause screen are tested with real local canvas video streams in the browser suite. The regular demo playback screen remains a labelled simulation; it does not reproduce Jellyfin’s actual player. Test the integrated player UI on the installed server using Down/Browse or Pause.
