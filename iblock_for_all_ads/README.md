# iBlock for all Ads - Twitch Youtube Anime-sites

A Manifest V3 Chrome extension with two blocking modes:

- **Regular**: blocks common banner ads, image ads, GIF ads, sponsored DOM blocks, ad iframes, and click-triggered popup/tab-under traps.
- **Super**: keeps Regular mode and enables broader network rules plus stronger overlay/video-ad heuristics.

## What it does

- Hides many in-page ad containers and sponsored overlays.
- Blocks common ad/tracker/ad-media requests using `declarativeNetRequest`.
- Suppresses many popup/popunder/tab-under click traps on ad-heavy streaming and shopping sites.
- Logs **unique hostnames** where a likely video ad was detected.

## Important limit

This extension is **best effort**, especially for Twitch/YouTube-style player ads. It can remove a lot of ad UI and block many ad-related requests, but it **cannot guarantee** universal blocking of every server-stitched or dynamically inserted stream ad.

## Files

- `manifest.json` — MV3 manifest
- `service_worker.js` — mode switching, storage, and site logging
- `content.js` / `content.css` — DOM blocking, popup suppression, video-ad heuristics
- `popup.*` — browser action popup
- `options.*` — full log and stats page
- `rules/regular_rules.json` — regular DNR ruleset
- `rules/super_rules.json` — additional DNR ruleset for super mode

## Load unpacked

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `iblock_for_all_ads` folder

## Pack for submission

Use Chrome's **Pack extension** button in `chrome://extensions`, or zip the folder for distribution/testing.


## Whitelist
- Add up to 50 domains to the whitelist.
- Whitelisted domains and their subdomains bypass both DOM blocking and network request blocking.
- Use the popup for the current site or the options page to manage the full list.
