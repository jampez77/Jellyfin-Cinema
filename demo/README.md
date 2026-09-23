# Local preview

Run `npm install`, `npm run build`, and `npm run dev` from the project root. Open [the preview](http://127.0.0.1:4173/).

The preview loads the same layout bundle used by Jellyfin, with a separate in-memory API supplying fictional media. It needs no Jellyfin credentials and makes no network requests after the local page and bundled photographs have loaded. The small switcher at the top belongs only to this preview.

- **TV Shows:** browse five fictional series using search, genres, A–Z/#, favourites and native-style episode suggestions. Open North of Nowhere to try its full episode browser. North of Nowhere has three seasons and six episodes per season. The first episode is watched; the second is partially watched. Down from the last episode advances to the next season; Up from the first returns to the previous season’s last episode.
- **Movies:** the library includes search, letter filters, genres, favourites and suggestions. Open a card to view its details; After the Tide has a resume position, a trailer action, cast, technical metadata and four related films. The trailer opens its own labelled playback simulation and preserves the film’s resume position.
- **Live TV:** Four channels share a horizontal programme timeline, with varied programme durations. Left/Right browses time, Up/Down browses channels, and artwork for the highlighted programme fits above the schedule, including future programmes. The schedule is calculated when the page loads.
- **Home:** library links, Continue watching, Next up and latest additions, with a featured title. Native-only destinations such as settings/search are not simulated.
- **Music:** fictional albums, artists and tracks, with search, genres, A–Z/#, favourites and suggestions. Open an artist to see albums, then an album to select its tracks.
- **Recordings:** completed and active recordings, search and direct playback. Scheduling links point to Jellyfin's native pages, which the local fixture does not implement.

Movies and TV Shows start on Suggestions. Selecting a currently live programme or a channel name in the guide starts its simulated channel; upcoming programmes stay selected without playback.

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

## Collections and theme videos

The preview includes **Coastal Stories** for After the Tide and **Into the Wilderness** for North of Nowhere. Collection cards open the styled collection page with links to its members. The Collections preview control opens the library list at `/#/list?parentId=library-collections`. Back restores the selected card. Series overviews now scroll down to recommendations as well as collections.

Native theme-video integration is covered by browser tests using a local canvas video stream. The preview does not download or autoplay a sample theme video; installed Jellyfin clients use their existing theme player and preferences.

In-player browsing and the pause screen are tested with real local canvas video streams in the browser suite. The regular demo playback screen remains a labelled simulation; it does not reproduce Jellyfin’s actual player. Test the integrated player UI on the installed server using Down/Browse or Pause.
