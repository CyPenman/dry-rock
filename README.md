# Dry Rock

UK crag conditions finder - given a date range, where in England and Wales is the rock
most likely to be dry and climbable, and on which day. Personal use, no accounts, no
backend. Built from [`CRAG-CONDITIONS-SPEC-v2.md`](../CRAG-CONDITIONS-SPEC-v2.md).

Data from [Open-Meteo](https://open-meteo.com) (CC-BY-4.0), fetched directly from the
browser. State lives in IndexedDB and localStorage on-device.

## Develop

```bash
npm install
npm run dev
```

## Test

```bash
npm test
```

## Build

```bash
npm run build
```

## Deploy

Pushing to `main` builds and deploys to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). The Vite `base` in
`vite.config.ts` is set to `/dry-rock/` to match this repo's name - if you fork this
under a different repo name, update `BASE_PATH` there to match.

Once deployed, open the Pages URL on Android Chrome and use "Add to Home Screen" to
install it as a standalone app.
