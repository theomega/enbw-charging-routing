---
status: implemented
---

# Scroll position lost on a GPS-triggered rebuild

> Scrolling wiederherstellen bei Refresh bei GPS Update.

**Cause A — the rows unmount.** `useRoutes` refetches once the position moves
≥ `ROUTE_REFRESH_DISTANCE_M` (2 km). Route ids are `index-distance-duration`, so
a route measured 2 km further on is a different id, which misses the
`useCorridor` cache. `status` goes `routing` → `placing`, `ChargerList`
early-returns a skeleton in both, and every row leaves the DOM. The document
scrolls (there is no inner scroll container), so the page collapses to one
viewport, the browser clamps `scrollY`, and the list returns at the top.

**Cause B — the content shifts.** The new route starts where you now are, so
passed stations leave the corridor and drop off the front. Restoring a pixel
offset alone leaves a _different_ station under the eye.

## Mapbox investigation

No cross-request route identity exists. `uuid` is per _response_ — Mapbox:
"Combination of `uuid` and the index in `routes` array uniquely identifies the
route" — and route objects carry no id field at all. Mapbox's own SDKs identify
routes by request uuid + array index, and mapbox-directions-swift#452 removed
their `routeIdentifier` concept rather than stabilising it.

What does exist is **Directions Refresh**:

    GET /directions-refresh/v1/mapbox/driving-traffic/{uuid}/{route_index}/{leg_index}

Needs `enable_refresh=true` on the original request, `driving-traffic`,
`overview=full`, and one of the congestion/maxspeed/speed/duration/distance
annotations — the app already meets all but the flag. Returns per-leg
`annotation` (the same per-segment arrays `core/route.ts` consumes), plus
`incidents`, `closures`, `notifications`. No geometry, no new routes.

## Decision: stop re-routing on distance travelled

One route per journey. The 2 km refetch exists only to move the route's start to
where you are, and that is obtainable locally: project the live position onto
the fixed geometry with `nearestPointOnLine` (already imported, already run
against this geometry for every station).

- along-route figures = `alongDistance(station) − alongDistance(you)`, free
- passed stations drop by `alongDistance(station) < alongDistance(you)`, free
- traffic/ETA stay honest via Directions Refresh, which never changes identity
- re-route only on deviation and on destination change

This removes Cause A (no `routing`/`placing` state to enter), and removes the
`setSelectedId(fetched[0])` bug that silently un-picked the driver's chosen
alternative every 2 km — the route object is never replaced, so there is nothing
to re-match. Cause B survives, so the scroll anchor is still built.

Splitting `anchor`'s double duty is what makes this work: it is currently both
the route origin _and_ the Matrix origin for detour pricing. The route origin
becomes fixed per journey; the Matrix origin keeps stepping (see open questions
— `detourCacheKey` rounds to ~111 m, so a live origin would re-spend Matrix
quota every 100 m).

## Agreed behaviour

- **During a rebuild:** no cue. Retained numbers are already up to 2 km stale in
  normal driving; an in-flight recompute is no worse.
- **Anchor row:** the open detail panel's row if one is open, else the topmost
  row below the sticky header.
- **Mechanism:** rows are already keyed by station id (`ChargerList.tsx:125`),
  but a React key preserves DOM identity, not scroll — the offset lives on the
  scroll container (the document) and React never touches it. The browser
  feature that _does_ do this is CSS scroll anchoring (`overflow-anchor: auto`,
  on by default), but per MDN browser-compat-data it is Chrome 56 / Firefox 66 /
  **Safari 27**, which only just shipped. The tester is on iPhone Safari, so it
  cannot be relied on — though newer phones will quietly do the right thing on
  top of whatever we write.
  A passive, rAF-throttled scroll listener keeps `{id, top}` current for the
  anchor row; a `useLayoutEffect` keyed on the driver's progress restores it.
  The listener is unavoidable: `useLayoutEffect` runs _after_ the DOM mutation
  and function components have no `getSnapshotBeforeUpdate`. Find the topmost
  row by binary search over `results` on `offsetTop` rather than measuring all
  45 rects per frame.
- **Anchor gone:** jump to top. Conservative in practice — when scrolled down,
  the topmost visible row is a station _ahead_, which survives; the anchor only
  vanishes when you were already near the top.
- **Scope:** GPS-driven change only, reaffirmed after considering continuous
  anchoring. A filter change or detour pricing landing resets to the top; a new
  destination shows the skeleton; another route alternative jumps to top because
  the anchor is gone. Cheap to scope now that the route object is never
  replaced: the driver's projected progress is the only thing that drops passed
  stations, so keying the layout effect on it _is_ the GPS-only filter.
- **Destination change:** clear routes and stations immediately, so the map
  empties and the list shows the skeleton. Nothing on screen should belong to a
  destination you are no longer driving to. (The `RoutePicker` map keeps drawing
  the old route line today.)
- **iOS caveat:** a programmatic `scrollBy` during momentum scrolling cancels
  the fling, so skip the correction if the user scrolled within ~150 ms.
- **Related:** `expandedId` is a bare charger id in `App`, so the open panel
  silently vanishes if its station leaves the list. Same root cause, handled by
  the anchor-is-gone rule.

## Agreed behaviour, no-re-route half

- **Deviation:** offer, never automatic. A banner („Du fährst nicht mehr auf der
  Route" + „Neu berechnen") when off the line; the driver taps it. A charging
  stop must never trigger a recompute that empties the list while they are
  standing at the charger. _Assumption to confirm in review:_ banner at > 2 km
  off the line (well inside the 10 km corridor, so the station list is still
  sensible), and dismissible.
- **Matrix origin step:** keep 2 km, exactly today's cadence, so nothing
  regresses. „Zur Ladestation" stays ≤ 2 km stale; ~8 Matrix requests per step.
- **Traffic refresh:** on the existing header Refresh button only, alongside
  availability. No background spending, and „Stand HH:MM" then honestly covers
  the route figures too. Needs `enable_refresh=true` added to the Directions
  request and the response `uuid` kept on `RouteOption`.
- **Passed stations:** drop once the route point is behind you _and_ you are
  more than ~1 km from the station itself. Keeps the charger you pulled in at on
  screen, and stops GPS jitter at a route point flickering a row.

## What was built

**Service layer**

- `directions.ts` — `enable_refresh=true`; `uuid`/`routeIndex` on `RouteOption`;
  id is now `uuid-index`, so a traffic refresh cannot move it. The old
  `index-distance-duration` scheme survives as the no-uuid fallback.
- `directionsRefresh.ts` (new) — the refresh call, plus a pure `refreshedRoute`
  that refuses an answer whose annotations do not cover every segment.

**Pure core**

- `progress.ts` (new) — `routeProgress`, `isOffRoute`, `remainingRoute`, and
  `aheadOfDriver`, which drops passed stations and re-measures the rest from the
  driver in one pass.

**Hooks**

- `useRouteProgress.ts` (new) — geometry memoised per route object, projection
  per GPS tick.
- `useSteppedOrigin.ts` (new) — the 2 km Matrix origin, split out of `anchor`.
- `useRoutes.ts` — one route per journey; `reroute()`; `refreshTraffic()`;
  clears on destination change; no longer resets the driver's alternative.
- `useCorridor.ts` — placement cached by route _object_ (WeakMap), so a traffic
  refresh re-places and an alternative switch still hits.
- `useAvailability.ts` / `useDetours.ts` — effects keyed on _membership_ rather
  than array identity. Load-bearing: the candidate list is now rebuilt on every
  GPS tick, and an identity dependency would have fanned out 45 EnBW requests
  every fifty metres. Also fixes a latent bug where changing any setting
  re-fetched all 45.

**UI**

- `ChargerList.tsx` — rows survive a re-place; scroll anchor (passive
  rAF-throttled listener + `useLayoutEffect` keyed on `drivenM`); anchor row
  found by binary search.
- `App.tsx` — the deviation offer in the sticky header, dismissible; header
  shows remaining rather than total; closes the panel when its station leaves.
- `RoutePicker.tsx` / `RouteMapSheet.tsx` — captions subtract the distance
  already driven. A regression introduced by this change: those totals used to
  mean "from you" because the route started at the driver. Alternative deltas
  are still computed off the full totals, where a shared constant cancels.

## Not carried over

Per-station along-route _times_ follow a traffic refresh only because the
placement re-runs (the WeakMap key). If that ever becomes too slow to redo on a
Refresh press, the alternative is storing `segmentIndex`/`t` on `ChargerOnRoute`
and deriving the figures at read time.

## Tests

`core/progress.test.ts` (15), `services/mapbox/directionsRefresh.test.ts` (9),
plus new cases in `directions.test.ts` and `ChargerList.test.tsx` — the latter
stubs a fake layout in jsdom so the anchor correction is actually exercised:
rows retained during a re-place, the correction on a GPS change, no correction
on a filter change, top on a lost anchor, and no-op at the top of the list.

227 tests pass; typecheck and build clean.
