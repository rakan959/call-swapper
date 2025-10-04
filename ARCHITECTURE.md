# Architecture

## Overview

- **UI (React)**: Calendar page with resident filter, side panel, and actions.
- **Data**: CSV fetch → `parseCsvToDataset` → validated `Dataset`.
- **Domain Core (pure)**: Types, feasibility rules (`rules.ts`), scoring (`simipar.ts`), index building.
- **Engine**: Candidate enumeration + ranking; Worker pool interface (message passing).
- **Workers**: Parallel feasibility checks and scoring; pure computations.

```
UI (App.tsx)
 ├─ CSV Loader ──▶ Dataset
 ├─ Calendar (FullCalendar)
 ├─ Side Panel (select shift)
 ├─ Actions: findSwapsForShift / findBestSwaps
 │    └─ Engine
 │        ├─ buildContext
 │        ├─ enumerate candidates
 │        ├─ workers (thresholded)
 │        ├─ rules.isFeasibleSwap (pure)
 │        └─ simipar.proximityPressure (pure)
 └─ Table (TanStack) [later]
```

## Module Boundaries

- `src/domain/*`: Pure functions; no network, no DOM, deterministic.
- `src/engine/*`: Orchestration & parallelization; calls domain; serializable messages.
- `src/utils/*`: CSV parsing, small helpers. Side-effecting allowed but deterministic.

### Dependency Rules

- `domain` depends on nothing else (except std libs).
- `engine` may depend on `domain` and `utils`.
- `ui` (`App`) depends on `engine` and `utils`; never the inverse.

## Error Handling

- Domain returns booleans or throws typed `Error & { code: string }`.
- Engine catches and converts to result envelopes for the UI.
- UI shows toasts/messages; never crashes.

## Logging

- Console warnings for recoverable issues; no PII.
- Structured messages `{ where: 'engine', event: 'worker_timeout', detail }`.

## Parallelization Strategy

- Threshold `CANDIDATE_WORKER_THRESHOLD` (default 200). Below that, run on main thread.
- Above threshold: chunk pairs into `n = navigator.hardwareConcurrency - 1` workers, round-robin dispatch.
- Each worker:
  - Validates feasibility → filters.
  - Computes `proximityPressure` for feasible pairs.
- Main merges results and sorts.

## Keeping Core Pure

- All time computations use explicit ISO strings and dayjs.
- No singletons; pass `Context` explicitly.
- Provide dependency injection for clocks if needed later.

### Time Handling

- `@utils/dayjs` centralizes plugin setup (UTC + timezone) and sets a default timezone from
  `VITE_TZ` (falling back to `America/New_York` and still honoring
  `VITE_DEFAULT_TIMEZONE` for backwards compatibility).
- Feature code imports from `@utils/dayjs` instead of `dayjs` directly to keep computations
  consistent across UI, domain, and tests.
