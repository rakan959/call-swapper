# Call Swap Finder (Static)

- Static site (GitHub Pages deploy from `dist` artifact)
- Calendar of shifts from public Google Sheets CSV
- Find feasible swaps & best swaps with parallelized browser engine

## Prerequisites

- Node 20 (project includes an `.nvmrc`; run `nvm use` before installing dependencies).

## Configure

Environment variables are loaded by Vite at build time:

- `VITE_CSV_URL` – schedule CSV export URL (defaults to the published sheet).
- `VITE_ROTATION_CSV_URL` – optional rotation CSV; provides vacation/rotation context when set.
- `VITE_TZ` – override the default `America/New_York` timezone used for all day/time math.

Sample data for local testing lives in `public/examples/schedule.csv`; treat it as illustrative only and prefer the live Google Sheet for production builds.

For ad-hoc testing without rebuilding you can still run `window.__CSV_URL__ = 'https://...export?format=csv'` in the browser console.

## Install

```bash
npm install
```

## Build & Deploy

- `npm run build` emits a static site into `dist/` (the folder is generated on demand and not committed).
- `npm run check:dist` verifies `dist/index.html` exists when you need to ship an artifact.
- GitHub Pages deploys from the `dist/` artifact via `.github/workflows/gh-pages.yml`.

The `public/` directory ships shared assets such as `favicon.svg` and `robots.txt`.

## Operational runbook

- **Update schedule sources:** set `VITE_CSV_URL` (and optionally `VITE_ROTATION_CSV_URL`) in your deployment environment or `.env` file. Leaving them unset falls back to the baked-in sample URLs, and the app now emits a single debug warning so you can spot the default in local builds.
- **Validate a CSV export:** download the candidate file and run `npm run test -- tests/unit/csv.spec.ts` to execute the parsers/contract checks. See `CONTRACTS/csv.md` for schema expectations.

## Dev

See `CONTRIBUTING.md` for the full script catalog.
