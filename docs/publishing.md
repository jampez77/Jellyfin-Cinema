# Publishing a release

The public GitHub repository is [jampez77/ScreenHarbour](https://github.com/jampez77/ScreenHarbour), renamed from `jampez77/Jellyfin-Cinema`. Jellyfin reads [the checked-in catalogue on main](https://raw.githubusercontent.com/jampez77/ScreenHarbour/main/manifest.json); the ZIP files live in this repository's GitHub Releases. Publish only to this repository. Keep the existing catalogue releases from 0.2.0 onward; older TV Item Layout releases from the separate original repository remain outside it.

1. Keep the three-part release version in `package.json`, `server/Jellyfin.Plugin.TvItemLayout.csproj` and `scripts/package-plugin.sh` in sync. The server build adds `.1` for 10.10.7, `.2` for 10.11.x, and `.3` for 12.x. Each DLL's assembly version must match its catalogue entry.
2. Update installation docs and release notes before packaging, since each ZIP includes `INSTALL.md`. Run the frontend and server verification commands from the README.
3. Run `bash scripts/package-plugin.sh all`, then `python3 scripts/create-manifest.py`. Update the generator's changelog for the release. It validates the archives and uses Jellyfin's required ZIP MD5 checksum. It preserves older catalogue versions from this repository, including URLs under the known former `Jellyfin-Cinema` name: only that URL prefix changes to `ScreenHarbour`. Existing version numbers, checksums, timestamps and changelogs stay intact. Unrelated repositories remain excluded. Each new ZIP also has a SHA-256 file for direct downloads.
4. Commit the source, docs and manifest. Create a tag such as `v0.2.26` at that commit and push the commit and tag to `jampez77/ScreenHarbour`. Create a GitHub prerelease with the three matching ZIP files, their three SHA-256 files, and `manifest.json`. Keep prerelease status until physical server and TV testing supports a stable release.
5. Verify that the public raw manifest resolves, every referenced release asset downloads without authentication, and its MD5 matches. Check each new archive against its SHA-256 file as well. Verify that 10.10.7, 10.11.x and 12.x each select the correct highest compatible plugin version.

Treat published version numbers and their assets as immutable. Use a new release version for subsequent fixes so Jellyfin offers an update and clients retrieve the new bundle.

## ScreenHarbour rename

Version 0.2.26 changes the public plugin name, repository, artwork and client labels to ScreenHarbour, following [Jellyfin's third-party branding guidance](https://jellyfin.org/docs/general/contributing/branding/). Describe it as **A cinematic interface for Jellyfin.** Make clear that it is an independent project, not affiliated with or endorsed by Jellyfin.

Keep GUID `1a06b74f-7609-4af9-899d-430c9b5a52b1`, the `Jellyfin.Plugin.TvItemLayout` assembly/namespace, `/TvItemLayout` routes, `jellyfin-tv-layout.js`, startup/registration identifiers and legacy archive names stable for existing clients and installations. Keep browser storage keys, route parameters such as `cinemaProvider`, and server data paths under `jellyfin-cinema/` unchanged. These are compatibility identifiers, not the public product name; renaming them would disconnect saved collection rows and provider choices. The npm package and public documentation use ScreenHarbour.

Existing users replace the old catalogue repository entry with `https://raw.githubusercontent.com/jampez77/ScreenHarbour/main/manifest.json`, then update without uninstalling. This is a rename of the existing GitHub repository, so its releases move with it. Verify the old GitHub repository, raw catalogue and release-asset URLs redirect successfully before announcing continuity; do not assume redirects work. Do not recreate the old repository name, because doing so can break those redirects. Confirm that previous versions remain present in the generated catalogue with unchanged checksums.

Deploy the demo again after the repository rename, and verify [the new Pages URL](https://jampez77.github.io/ScreenHarbour/?layout=desktop&featured=0#/home). GitHub repository redirects do not establish that the former Pages path redirects. Public links must use the new path.

The checked-in catalogue cover is `assets/catalogue/screenharbour.png`; its artwork prompt is recorded alongside it in `prompt.txt`. Ensure its public raw URL resolves when publishing. Artwork is illustrative, not a screenshot of a real library. Historical release notes retain their original names and release-era descriptions; historical screenshots are labelled as predating the rebrand.

Prepared release entries point to assets that may not yet be public. Publish the matching release archives before merging that manifest to `main`, then run the public-download and checksum checks above. A successful local package build is not a published release.
