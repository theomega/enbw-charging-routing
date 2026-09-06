# Ladestopp — EnBW chargers along your route

A mobile-browser SPA. Enter a destination and get the chargers along the route, in
the order you drive past them, each showing how far away it is (km and minutes), how
much detour it costs (minutes), and how many charge points are free right now. Tapping
a charger hands off to Apple or Google Maps. Your last destination is remembered, so
reopening the app mid-trip picks up where you left off.

No accounts, no server-side state — destination history and settings live in
`localStorage`.

## Setup

This project uses **pnpm**, pinned via the `packageManager` field. Node ships with
Corepack, so you do not need a global install:

```bash
corepack enable pnpm   # once per machine
pnpm install
```

**1. Mapbox token** (routing, detour, destination search)

Create a free token at [account.mapbox.com](https://account.mapbox.com/access-tokens/),
then:

```bash
cp .env.example .env
# edit .env and paste your pk.* token
```

**Scopes: none required.** The three APIs this app calls — Geocoding v6, Directions
v5, and Directions-Matrix v1 — are public APIs that work with any valid public token.
Use the *Default public token*, or create a new one and leave the scope checkboxes at
their defaults. The default public scopes (`styles:tiles`, `styles:read`, `fonts:read`,
`datasets:read`, `vision:read`) cover styles and tiles; none of them gate routing or
search. Mapbox lists a required scope in an endpoint's docs whenever the default token
lacks it, and these three list none.

It must be a **`pk.`** token, not `sk.` — the token ships in the JS bundle, so a secret
token would be published. `src/services/mapbox/client.ts` refuses anything that does not start
with `pk.`.

Because the token is public, **URL restrictions are the actual security control**. Add
`http://localhost:5173/*` and your deployed origin in the token settings. Note that URL
restrictions are incompatible with Mapbox's *native* SDKs — fine for this browser SPA,
but it would break if you ever wrapped it in a native shell.

**2. EnBW subscription key** (station list and live availability)

EnBW has no official public API. The app uses the undocumented endpoint behind
EnBW's own charger map, which needs the same subscription key that map sends.
To find it: open <https://www.enbw.com/elektromobilitaet/produkte/mobilityplus-app/ladestation-finden/map>,
open DevTools → Network, and read the `Ocp-Apim-Subscription-Key` request header
on any `chargestations` call.

```bash
echo 'ENBW_SUBSCRIPTION_KEY=<the key>' > .dev.vars   # local dev
pnpm wrangler secret put ENBW_SUBSCRIPTION_KEY       # production
```

**3. Build the station list**

The app ships with a list of every EnBW-tariff station and only asks the API about
occupancy. Generate it once:

```bash
pnpm build:stations                                   # DE + AT + northern Italy
pnpm build:stations -- --bbox 48.55,48.85,9.0,9.4     # a small region, for a quick check
pnpm build:stations -- --resume                       # continue an interrupted run
```

It asks the API for EnBW-tariff stations at 50 kW and above, and both filters are applied
server-side — see [Is there a listing endpoint?](#is-there-a-listing-endpoint). Measured for
the default area: **1,789 requests in 41 seconds, 2,400 stations, 203 KB (73 KB gzipped)**
written to `public/stations.enbw.json`. It was 3,578 requests and 2.8 minutes before the
`minPower` filter.

The file carries station *identity* — address, power, point count, operator — which is why
it is 203 KB rather than 74 KB, and why every row on screen is fully described before any
network call. See [What the list carries](#what-the-list-carries). Re-run it every month or
so, and after any run of stale rows — see [Known limitations](#known-limitations).

## Running

The charger calls **must** go through the Worker — see [Why a proxy](#why-a-proxy).
So local dev needs both processes:

```bash
pnpm dev:worker   # terminal 1 — Worker on :8787
pnpm dev          # terminal 2 — app on :5173, proxies /api to the Worker
```

Geolocation needs a secure context. `localhost` counts, but a real phone on your LAN
does not — use a tunnel (`cloudflared tunnel --url http://localhost:5173`) or the
deployed URL when testing on a device.

The app ships a web manifest, so it installs to the home screen and runs standalone.
There is no service worker: installed is not offline, and it always loads fresh.

```bash
pnpm test        # unit tests, hermetic and offline
pnpm typecheck   # app + worker
pnpm build       # production bundle
```

Deploy: `pnpm deploy:worker` for the API, and any static host for `dist/` — with two
constraints.

**Route `/api/*` to the Worker.** The client calls `/api/chargers` **same-origin**
(`src/services/enbw/availability.ts` hard-codes the path; there is no configurable API
base). Cloudflare Pages with a Worker route on the same zone does this; a host that only
serves files does not.

**Do not cache `/stations.enbw.json` for long.** Unlike the JS and CSS, it is served from
`public/` with no content hash in its name, so a long `Cache-Control: max-age` means phones
keep serving an old station list and a rebuild is invisible to them — including the rebuilds
that clear [renumbered stations](#enbw-renumbers-stations). Set
`Cache-Control: max-age=0, must-revalidate` (or a short max-age with an ETag) for that one
path.

## Why a proxy

EnBW's gateway *looks* browser-callable — the CORS preflight answers
`access-control-allow-origin: *` and allows the subscription-key header — but the
actual GET is gated on the `Origin` header:

```
Origin: https://www.enbw.com   -> 200
Origin: http://localhost:5173  -> 403 forbidden
```

Browsers set `Origin` themselves and JavaScript cannot override it, so the call has
to happen server-side. `worker/index.ts` does that: it fans out one upstream request per
station, so a phone on a slow connection makes one request instead of twenty, and trims each
upstream record (3.8 KB average, 24 KB for a big hub) down to the four numbers the client
actually needs.

The Worker answers `access-control-allow-origin: *` and does not check who is calling,
so **a deployed Worker is an open proxy for your subscription key**. It is bounded — one
route (`POST /api/chargers`), at most 60 station ids per call, responses cached 60 s — but
anyone who finds the URL can spend your key against it. If that matters,
gate it on `Origin` or put Cloudflare Access in front.

## How it works

1. **Route** — Mapbox Directions (`driving-traffic`) with `annotations=distance,duration`
   and `alternatives=true`.
2. **Find the chargers — with no network call at all.** The route is buffered into a 10 km
   corridor (`turf.buffer`) and the 2,400 shipped stations are tested against it
   (`turf.booleanPointInPolygon`). That gate is a cheap superset; it only decides what is
   worth measuring exactly.
3. **Distance and time** (`src/core/corridor.ts`, `src/core/route.ts`) — each surviving charger
   is projected onto the route polyline with `turf.nearestPointOnLine` and read off the
   cumulative Mapbox annotations, so the figures are road distance and traffic-aware time, not
   crow-fly geometry. The corridor is 10 km either side (`DEFAULT_MAX_OFFSET_M`); anything
   further is not worth a stop. It is deliberately generous, because offset is straight-line
   distance and a motorway running one side of a valley can leave a charger several kilometres
   away in a straight line but only a few minutes off the drive — the detour column prices that
   properly, and it can only price rows that got this far. Zero API cost, so every charger in
   the corridor has these figures.

   This is the one visibly expensive step — roughly 650 ms for a 318 km route on a laptop,
   a few seconds on a phone — so it runs in chunks, yields the main thread between them and
   drives a real progress bar rather than an indeterminate shimmer.
4. **Live occupancy** (`src/services/enbw/availability.ts`) — only for the ~20 rows actually
   shown, and only the occupancy. Everything else about a station is already known from the
   list, so this step can only add the `n/m free` badge; it can never decide what a row *is*.
   EnBW has no bulk endpoint (`?stationIds=`, `?ids=`, `/batch`, `/status`, comma-joined ids
   and `POST` are all rejected), so it is one `GET /chargestations/{id}` per station —
   typically 17–20 requests. See [Why not bounding boxes](#why-not-bounding-boxes).
5. **Detour** (`src/core/detour.ts`) — `T(origin→charger) + T(charger→dest) − T(origin→dest)`,
   from two Mapbox Matrix calls per 23 chargers.

   `t_direct` is deliberately read from the *same* matrix call (by appending the destination as an
   extra target) rather than reused from step 1: the route uses `driving-traffic` and the matrix
   uses `driving`, and subtracting across profiles yields nonsense, routinely negative.
6. **Hand off** — the list is always in **route order**, the order you drive past them. There is
   no sort control: `placeChargersOnRoute` orders by along-route distance and nothing downstream
   re-orders.

### Layout

Three layers, and the dependency arrows only ever point downwards.

```
src/core/       the maths. No I/O, no React, no wire formats.
                types · geo (the TurfJS seam) · route · corridor · detour · filters
src/services/   everything that talks to something.
                mapbox/{client,geocoding,directions,matrix,staticMap}
                enbw/{wire,stations,availability}
src/search/     the pipeline, as React hooks.
                useRoutes · useCorridor · useAvailability · useDetours
                useRouteSearch composes them and is the only thing App.tsx sees
src/components/ presentation
src/state/      persisted destination and settings
```

`core` never imports `services`: detour pricing takes the matrix function as a
parameter, so the arithmetic is testable without a network and the Mapbox client is not
a hidden dependency of the geometry. `services` never imports `search`. Each hook in
`search` owns exactly one effect, which is what makes them individually readable —
this used to be one 362-line hook with four interleaved effects and its caches in refs.

### Geometry

All geo maths is [TurfJS](https://turfjs.org). There is no hand-rolled haversine, no
equirectangular projection, no bespoke Douglas–Peucker, and no coordinate pair indexed
by hand outside `src/core/geo.ts` — that file is the single seam between this app's
`{ lat, lon }` and Turf's `[lon, lat]`, because getting that backwards produces a
plausible-looking point in the wrong hemisphere.

| Job | Turf |
|---|---|
| Corridor around the route | `buffer` + `booleanPointInPolygon` |
| Where along the route a charger sits | `nearestPointOnLine` |
| Distances (GPS movement, segment fractions, offsets) | `distance` |
| Thumbnail polyline reduction | `simplify` |
| Occupancy box covers | `bbox` |

Two things this costs, both accepted:

- **Speed.** `nearestPointOnLine` against a full 6,700-vertex route is far slower than
  the equirectangular loop it replaced. A spatial index over the route segments would
  claw most of it back, at the price of the corridor no longer reading as "buffer the
  route, keep what is inside". The plain version wins, and the wait is shown rather
  than hidden — see the progress bar in step 3 above.
- **Bundle.** `@turf/buffer` carries a port of JTS, which is most of the 130 kB gzipped
  bundle on its own.

Only the individual `@turf/*` packages are dependencies, never the `@turf/turf`
meta-package, which would pull the entire library into the bundle.

### Why a static station list

The app used to discover chargers at runtime by tiling the route corridor and asking EnBW what was
inside each box. That blind scan cost **907 upstream requests for one 743 km route**, and carried a
long tail of problems: tile coverage gaps, cluster placeholders, subdivision depth limits,
subrequest budgets, truncation reporting.

None of it was necessary. The station set changes a few times a month; only occupancy changes
minute to minute. Generating the list offline replaced all that machinery with local geometry and
roughly **20–30 requests per route**, which fits inside Cloudflare's free-plan limit of 50
subrequests per invocation.

### What the list carries

```
fields: [stationId, lat, lon, maxPowerKw, address, totalPoints, operator]

[3029234, 47.25844, 11.32309, 50, "Cytastraße 1, 6176 Völs, AT", 2, "SMATRICS"]
```

Packed positionally rather than as named objects — 2,400 rows of `{"stationId":…}` would
triple the file and nothing reads these by name. The client unpacks in
`src/services/enbw/stations.ts`.

The list is the source of truth for **who a station is**. The live call is the source of
truth for **how busy it is right now**, and nothing else. That split was learned the hard
way: identity used to come from the live call too, joined by station id, so any hiccup in
that call left a row reading `Station 2970018` with no address — see
[EnBW renumbers stations](#enbw-renumbers-stations). Identity has nothing to do with the
network, so it no longer depends on it.

Occupancy is deliberately **not** in the file. It is the one field that changes minute to
minute, and a month-old snapshot rendered as authoritative would be worse than the `?` the
app shows until the live lookup lands. `availablePoints` is `null` coming out of the list,
never `0`.

The builder refuses to write a list where more than 5% of stations have no address. A row
that cannot identify itself is now a build-time defect rather than something a driver
discovers on the motorway.

### Why not bounding boxes

The occupancy lookup used to ask for a small bounding box around each station, on the
theory that one box could cover several nearby candidates. Measured on a real route, it
covers exactly one — corridor candidates are kilometres apart:

| | Requests | Upstream | Time |
|---|---|---|---|
| 17 bounding boxes | 17 | 12 KB | 1550 ms |
| 17 station ids | 17 | 61 KB | 1310 ms |

Same request count, no latency penalty, and the extra bytes are on the Worker→EnBW leg,
which the Worker trims away before answering the phone. (An earlier note here claimed
1.4 KB per box against 16 KB per station; the 16 KB was a 54-point hub, and the real
average is 3.8 KB.)

The boxes cost far more than they saved, because **a box is answered through the clustering
grid** — any grid cell holding two stations collapses into a placeholder with no station id
and no occupancy, and the row it belonged to lost its identity along with its badge. Asking
for one station by id cannot cluster. That deleted `coveringBoxes`, three box-sizing
constants, the Worker's span guard, and every `grouped` check in the client.

### EnBW renumbers stations

Station ids are not stable. EnBW re-issued a contiguous block of Austrian (SMATRICS) ids;
measured four days after a list build:

| Sample | 404 from `/chargestations/{id}` |
|---|---|
| 124 shipped ids in 2.90M–3.00M | **71** |
| 25 shipped ids below 2.90M | 0 |

That is 3.0% of the whole list, in four days. Each dead station had exactly one replacement
at the same position with the same power:

```
shipped 2970018,  50 kW  ->  live 3029234 @0m,  50 kW  "Cytastraße 1, 6176 Völs, AT"
shipped 2969949, 150 kW  ->  live 3029144 @0m, 150 kW  "Gewerbestraße 2, 3373 Kemmelbach, AT"
```

A re-issued id 404s, so that row shows `?/n` until the list is rebuilt. Because identity now
lives in the list, that is the *whole* cost — the address, power and point count are still
right. Before this change the same event blanked the row.

A position-based fallback (adopt a same-position, same-power record under a new id) was
considered and rejected: it would have restored the badge, at the price of keeping the
grouping and fuzzy-matching machinery alive to serve 3% of rows. Rebuilding the list takes
41 seconds.

### Is there a listing endpoint?

No. The API exposes only the bounding-box query and `/chargestations/{id}` — confirmed by reading
EnBW's own map client, which uses exactly those two and nothing else. `?stationIds=`, `?ids=`,
`/batch`, `/status`, `/availability`, comma-joined ids and `POST` are all rejected.

But there is something almost as good, and undocumented: **`priceGroups` filters server-side.**
That matters far more than saving bandwidth. The API groups results by dividing the requested box
into an N×N grid and collapsing any cell with more than one station into a placeholder that carries
no station data. Filter to EnBW first and there is far less left to collide, so the grouping mostly
stops happening and the scan converges quickly instead of grinding down through empty space.

Measured over the same 0.3°×0.4° region:

| | Requests | Time | Stations | Converged |
|---|---|---|---|---|
| Unfiltered descent | 646 | 9.8 s | 201 | 4 clusters stuck |
| **`priceGroups=ENBW_GROUP`** | **69** | **2.6 s** | **202** | **fully** |

Cheaper *and* more complete — the unfiltered scan's own clustering had been hiding a station. Across
the full area this took the build from a projected ~100,000 requests and several hours down to
3,578 requests and under three minutes.

### And a second one: `minPower`

The same trick pays twice. `minPower=N` is an inclusive `maxPowerInKw >= N` filter, also
undocumented, and it is applied **before** the grouping grid. Since half the network is
below 50 kW, filtering it away upstream leaves far less to collide in any one cell, so the
clustering that forces a deep descent mostly stops happening.

Measured on two regions, against a scan that filters power afterwards instead:

| Region | `priceGroups` only | `+ minPower=50` | Stations |
|---|---|---|---|
| 48.3–49.3 × 8.7–9.7 | 301 requests, 7.6 s | **97 requests, 2.9 s** | 123 either way |
| 47.2–48.4 × 10.8–12.2 | 121 requests, 3.7 s | **93 requests, 2.5 s** | 77 either way |

The station sets come out identical, so this is purely cheaper — roughly **3x fewer
requests** on the first region.

Verified inclusive by sweep, which matters: `minPower=50` keeps the 50 kW stations and
`minPower=51` drops them, with no bucketing in between. A parameter that silently snapped
to the next preset would have quietly deleted the whole 50–99 kW band from the list. The
script applies the floor a second time after the scan for exactly that reason.

`groupingDivisor` is capped at **20**: swept 1–200, anything above 20 is silently ignored and falls
back to the coarse default, so 20 is the finest grid available and gives the fewest placeholders per
request.

The script keeps a targeted fallback for any cluster that survives to the size floor — it probes the
centroid the API reports rather than splitting blindly. On the filtered scan it never fires, but it
earns its place: on the *unfiltered* scan it recovered 190 stations, 5 of them EnBW, that the floor
was silently dropping.

## Route alternatives

Mapbox returns up to three routes (`alternatives=true`, no extra request cost) and each is shown as
a static map thumbnail with its road summary from `legs[].summary` — enough to tell "via SS44,
Jaufenpass" from "via A22" at a glance — plus distance, duration and penalty against the fastest.

Tapping an alternative re-places the corridor for it, which is now pure local geometry. Thumbnails
come from the Static Images API, with the polyline Douglas–Peucker-simplified (`turf.simplify`) until the URL fits
its character budget. Simplification is for display only — the corridor maths always uses the full
geometry.

**Detour is re-baselined onto the selected route.** `t_direct` from the Matrix is the *fastest*
path, so without correction every charger on a slower alternative inherits that route's whole
penalty — pick the Jaufenpass and a charger sitting on the road you are driving would read
`+22 min`. `routePenaltySeconds` subtracts it. This is approximate: it applies a `driving-traffic`
delta to a `driving` baseline. It is exactly zero in the default case, where the fastest route is
selected.

## Filters

The shipped list contains only stations on the EnBW tariff (`priceGroup === 'ENBW_GROUP'`), so
there is no provider filter at runtime — that selection happens offline, in the list builder.

**Why `priceGroup` and not `operatorCode`.** `DEEBW` is EnBW's *German* operator code. EnBW runs its
own network abroad under separate entities — `ITSMA` (SMATRICS EnBW Italia), `ATSMA` (SMATRICS
Austria) — and has German subsidiaries such as `DEODR` and `DESMA`. All bill at `ENBW_GROUP`.
Measured over 801 stations across five countries, `operatorCode === 'DEEBW'` matched 74 and
`priceGroup === 'ENBW_GROUP'` matched 79; every `DEEBW` station carries `ENBW_GROUP`. Filtering on
the operator code made the app useless outside Germany.

### Why 50 kW is a floor, not a default

The list ships only stations at **50 kW or above**, and there is no way to ask for less.
An 11 or 22 kW AC post is an overnight charger, not a stop you make in the middle of a
drive, so a slower station is never the answer to "where do I charge on the way?".

Half the network is below that line — 2,225 of 4,622 EnBW-tariff stations — so cutting it
at the source halves the file the phone downloads *and* halves the geometry the corridor
runs, rather than measuring thousands of stations only to filter them out on screen.

`MIN_POWER_KW` in `scripts/build-station-list.mjs` applies it when the list is built, and
`MIN_STATION_POWER_KW` in `src/services/enbw/stations.ts` applies it again at load — the
file is HTTP-cached, so a phone can still be holding a list generated before the floor
existed. Stations with unknown power are dropped too: "might be fast" is not good enough
to put in front of a driver.

Settings keeps: minimum power (50, 150 or 300 kW), maximum detour, and which maps app to hand
off to. The power chips only ever raise the floor.

There is no "hide fully occupied" toggle. A full station is still a station you might reach
in twenty minutes, and hiding it makes the list lie about what is on the road ahead — the
badge already says `0/2 free` in red. There is no plug filter either: it is CCS.

## Deep links

- Apple: `https://maps.apple.com/?daddr=<lat>,<lon>&dirflg=d`
- Google: `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lon>&travelmode=driving`
- `settings.mapsApp`: `'auto' | 'apple' | 'google'`; `auto` picks Apple on iOS/iPadOS, else Google.
- Single-stop only. Google supports `waypoints=` for charger-then-destination, but Apple has no
  reliable multi-stop URL scheme — keeping both single-stop avoids a confusing platform split.

## Testing against live data

`pnpm test` never touches the network. There is an opt-in integration check that runs the whole
path on real data — real Mapbox routes, the shipped station list, real EnBW occupancy through the
local Worker. Nothing in it is a fixture, which is the point: it catches what unit tests cannot,
like Mapbox quietly changing a response shape. It needs `VITE_MAPBOX_TOKEN` in `.env`:

```bash
pnpm build:stations     # once
pnpm dev:worker
SMOKE=1 pnpm vitest run src/search/liveSmoke.test.ts
```

`WORKER_URL` and `STATION_LIST` override the Worker address and the list it reads.

## Known limitations

- **The station list goes stale.** New or decommissioned stations are invisible until
  `pnpm build:stations` is re-run. This is the real cost of the whole approach. A station that has
  disappeared shows as `?/n` rather than a wrong number, but a *new* one simply will not appear.
- **Coverage depends on one offline run.** A build that silently under-scans would ship a
  permanently incomplete app, so the script prints its station count and warns loudly about any
  cluster it could not resolve — distinguishing EnBW-tariff clusters, which matter, from other
  operators' clusters, which do not.
- **Only the EnBW network, and only its fast half** — 2,400 stations at 50 kW or above.
  The roaming network your card also works at is
  roughly 311,000 charge points in Germany alone, far too large to ship, and `priceGroups` is what
  makes the EnBW slice cheap to enumerate in the first place. There is no widen-search escape hatch
  on routes where EnBW is thin.
- **The EnBW endpoint is undocumented.** It can change, the key can rotate, and the `Origin` gate
  could tighten. A 403 from the Worker almost always means one of those.
- **Finding the chargers takes a moment.** Every shipped station is measured against the route
  geometry, which is a few seconds on a phone for a long route. It runs in chunks behind a
  progress bar rather than freezing the list, and the result is cached per route, so switching
  between alternatives after the first look is instant.
- **Availability is a snapshot**, seconds to minutes stale, and a free point can be taken before you
  arrive. The header shows when it was fetched, next to a **Refresh** button that re-fetches
  occupancy only — never the routes or the station list, so it costs no Mapbox quota. There
  is no pull-to-refresh gesture and no auto-refresh.
- **Only the first 20 rows have live occupancy.** Every row is fully described — name,
  address, power, point count, operator — straight from the shipped list. What the rows past
  `ENRICHED_LIMIT` lack is the live count, so they read `?/8` rather than `6/8 free`.
- **Detour is priced for the 20 nearest candidates only.** The "Away" and "Drive" columns are free —
  they come from projecting each charger onto the route polyline, so every charger in the corridor
  has them. Detour needs real driving times to and from a point off the route, which costs Mapbox
  Matrix quota. Rows past the first 20 show `—`, deliberately distinct from `on route` (measured,
  costs nothing).

  Because the list is in route order, those 20 are exactly the next 20 you will reach. Raising
  `ENRICHED_LIMIT` in `src/search/useRouteSearch.ts` is cheap: Mapbox bills per
  *element* and the chunking sends `2k+1` elements for `k` chargers, so 20 chargers is 41 elements
  per search — roughly 2,400 searches inside the 100,000-element monthly free tier.
- **Detour uses the `driving` profile**, not `driving-traffic`, because the traffic profile caps
  matrix requests at 10 coordinates instead of 25. The headline route ETA is traffic-aware; the
  detour delta is not.
- **Building the list** is a heavier one-off use of an undocumented API than per-route scanning
  was, though the `priceGroups` filter reduced it by ~28x. The script runs at concurrency 4, honours
  `Retry-After` on HTTP 429 with a shared cooldown across all workers, and checkpoints after every
  depth so an interrupted run resumes with `--resume` instead of starting over.
