# Counterbuild

Deadlock item builds tuned to the heroes you're facing.

- Pick your hero (or find your live match from your Steam profile).
- Add the enemy heroes. Each gets threat tags (healing, spirit, gun, CC, dive, tanky) you can switch on or off.
- The build ranks items by real win rates for your hero over the last 30 days, scored against other items of the same tier, then boosts items that answer the enemy lineup.

Data: deadlock-api.com (community API, not affiliated with Valve).

## Files
- `rules.js` — hero threat tags and counter items. Edit this when a patch adds heroes or renames items.
- `engine.js` — build scoring (no network, no page code).
- `app.js` — loading data and drawing the page.
- `sw.js` — offline app shell. Bump `CACHE` after changing files.

## Hosting
Static files, no build step. GitHub Pages: push to a repo, Settings → Pages → Deploy from branch → `main` / root.
