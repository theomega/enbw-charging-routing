# Ladestopp — EnBW chargers along your route

A mobile-browser SPA. Enter a destination and get the chargers along the route, in
the order you drive past them, each showing how far away it is (km and minutes), how
much detour it costs (minutes), and how many charge points are free right now. Tapping
a charger opens it in place: a map of where it actually sits, the four numbers that decide
whether to stop there, its individual charge points, and a Navigate button that hands off to
Apple or Google Maps. Your last destination is remembered, so reopening the app mid-trip
picks up where you left off.

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
Use the _Default public token_, or create a new one and leave the scope checkboxes at
their defaults. The default public scopes (`styles:tiles`, `styles:read`, `fonts:read`,
`datasets:read`, `vision:read`) cover styles and tiles; none of them gate routing or
search. Mapbox lists a required scope in an endpoint's docs whenever the default token
lacks it, and these three list none.

It must be a **`pk.`** token, not `sk.` — the token ships in the JS bundle, so a secret
token would be published. `src/services/mapbox/client.ts` refuses anything that does not start
with `pk.`.

Because the token is public, **URL restrictions are the actual security control**. Add
`http://localhost:5173/*` and your deployed origin in the token settings. Note that URL
restrictions are incompatible with Mapbox's _native_ SDKs — fine for this browser SPA,
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
pnpm build:stations                                   # DE + AT + CZ + northern Italy
pnpm build:stations -- --bbox 48.55,48.85,9.0,9.4     # a small region, for a quick check
```

It asks the API for EnBW-tariff stations at 50 kW and above, and both filters are applied
server-side — see [Is there a listing endpoint?](#is-there-a-listing-endpoint). Measured for
the default area: **2,437 requests in 169 seconds, 2,436 stations, 677 KB (116 KB gzipped)**
written to `public/stations.enbw.json`. Of those requests exactly **one** is the station
scan; the other 2,436 are the per-station detail lookup for the location line and the
per-point powers, which is now the entire cost of the build. Those two arrive in the same
response, so the powers were free to add — the request was already being made. The scan used to be 1,881 requests on its own. Wall time
depends on whether the run trips the rate limiter — 53 s clean, 84 s on a run that did.

The file carries station _identity_ — location, address, power, the points at their own
powers, operator — which is why it is 677 KB rather than 74 KB, and why every row on screen is fully described
before any network call. See [What the list carries](#what-the-list-carries). Re-run it every
month or so, and after any run of stale rows — see [Known limitations](#known-limitations).

It is written **indented and sorted by station id**, because it is committed and a rebuild
has to be reviewable. Minified it was a single 300 KB line, so every rebuild diffed as "the
one line changed" and there was no way to see that a station had moved, lost a charge point
or disappeared. The sort is what makes that work: without a fixed row order the API's own
ordering leaks into the file and a rebuild looks like a reshuffle. Indenting costs 294 KB →
677 KB on disk but only **97 KB → 116 KB gzipped**, which is what phones actually download.

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

**Route `/api/*` to the Worker.** The client calls `/api/chargers/{stationId}`
**same-origin** (`src/services/enbw/availability.ts` hard-codes the path; there is no
configurable API base). Cloudflare Pages with a Worker route on the same zone does this; a host that only
serves files does not.

**Do not cache `/stations.enbw.json` for long.** Unlike the JS and CSS, it is served from
`public/` with no content hash in its name, so a long `Cache-Control: max-age` means phones
keep serving an old station list and a rebuild is invisible to them — including the rebuilds
that clear [renumbered stations](#enbw-renumbers-stations). Set
`Cache-Control: max-age=0, must-revalidate` (or a short max-age with an ETag) for that one
path.

## Why a proxy

EnBW's gateway _looks_ browser-callable — the CORS preflight answers
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
route (`GET /api/chargers/{stationId}`), one station per request, no cache — but anyone who
finds the URL can spend your key against it, and the free plan's 100,000 requests a day are
shared with your own searches. If that matters,
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

4. **Live record** (`src/services/enbw/availability.ts`) — only for the ~20 rows actually
   shown. Everything that decides what a row _is_ — name, address, power, its points and
   their powers — is already known from the list, so this step can only add to a row; it can never take its
   identity away. EnBW has no bulk endpoint (`?stationIds=`, `?ids=`, `/batch`, `/status`,
   comma-joined ids and `POST` are all rejected), so it is one `GET /chargestations/{id}` per
   station — typically 17–20 requests. See [Why not bounding boxes](#why-not-bounding-boxes).

   That request used to be trimmed to three numbers. It now also keeps the individual charge
   points and their plugs, because **the response already contained them** — see
   [What the live call keeps](#what-the-live-call-keeps).

5. **Detour** (`src/core/detour.ts`) — what stopping costs over driving past:

   ```
   [ T(origin→charger) − T(origin→routePoint) ] + [ T(charger→dest) − T(routePoint→dest) ]
   ```

   `routePoint` is where the charger meets the selected route, from step 3. Two Mapbox Matrix
   calls per 12 chargers carry all four numbers, so the whole subtraction happens inside one
   profile and the `driving-traffic` route never enters the arithmetic.

   See [Detour is measured against the route point](#detour-is-measured-against-the-route-point)
   for why it is not the simpler `T(origin→charger) + T(charger→dest) − T(origin→dest)`.

6. **Hand off** — the list is always in **route order**, the order you drive past them. There is
   no sort control: `placeChargersOnRoute` orders by along-route distance and nothing downstream
   re-orders.

### Layout

Three layers, and the dependency arrows only ever point downwards.

```
src/core/       the maths. No I/O, no React, no wire formats.
                types · geo (the TurfJS seam) · route · corridor · detour · filters
src/services/   everything that talks to something.
                mapbox/{client,geocoding,directions,matrix}
                enbw/{wire,stations,availability}
src/search/     the pipeline, as React hooks.
                useRoutes · useCorridor · useAvailability · useDetours
                useRouteSearch composes them and is the only thing App.tsx sees
                useChargerDetail is off to one side: one charger, on demand
src/components/ presentation. RouteMap wraps Mapbox GL; mapFeatures builds
                what it draws, so the decisions in it are testable without WebGL
                ChargerCard is the collapsed row, ChargerDetail the open panel
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

| Job                                                  | Turf                               |
| ---------------------------------------------------- | ---------------------------------- |
| Corridor around the route                            | `buffer` + `booleanPointInPolygon` |
| Where along the route a charger sits                 | `nearestPointOnLine`               |
| Distances (GPS movement, segment fractions, offsets) | `distance`                         |
| Occupancy box covers                                 | `bbox`                             |
| Framing the map on the routes                        | `bbox`                             |

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

### What the live call keeps

The `GET /chargestations/{id}` behind every occupancy badge returns a 3–9 KB record, and the
Worker used to reduce it to three numbers. It now keeps what a driver would actually read:

```
chargePoints[]  evseId, status, plug names, kW      the stall you drive up to
alwaysOpen, operatorCode
```

`additionalInfo` — the location line — is deliberately **not** in that set, even though this
is the only endpoint that returns it. It is the heading every row is displayed under, so
taking it from here would mean a row renaming itself the moment its panel was opened. The
list builder pays one request per station to bake it in instead; see
[What the list carries](#what-the-list-carries).

**Two blocks are dropped on purpose, not for size.** The response also carries `pricingInfo`
(a per-kWh rate, a blocking fee and a free-parking window) and `authenticationMethods`. Both
depend on the tariff the _driver_ is on, which this app has no way of knowing — so rendering
either would be quoting someone else's contract as though it were yours. They are not
modelled in `wire.ts` and never leave the Worker.

**This costs nothing.** It is the same request, to the same endpoint, that the badge has
always needed — the data was being fetched and discarded. Measured through the Worker:

| Station          | Upstream | Kept   |
| ---------------- | -------- | ------ |
| 4 charge points  | 3.2 KB   | 700 B  |
| 18 charge points | 8.9 KB   | 1.9 KB |

So a search moves roughly 18 KB instead of 2 KB for its 20 rows, and spends no extra request
to do it. The rest of the upstream record is dropped in the Worker rather than on the phone:
`viewPort`, `favorite`, `hiddenWithActiveProfile`, per-connector cable flags, and the address
and power the shipped list already carries.

Two `Charger` fields were **fixed** by this and a third was deleted. `operatorCode` and
`alwaysOpen` were declared on the type and hard-coded to `null` / `false` in `unpackStation`,
because the packed list does not carry them — so the UI would have rendered "not always open"
as though it were a fact. They are now `null` out of the list, meaning _unknown_, and are
filled in by the live call. Same rule as `availablePoints`: never measured and
measured-as-zero are different statements. `authMethods` was dead in exactly the same way,
but its contents are tariff-dependent, so it is gone from the domain type rather than fixed.

### The charger detail panel

Tapping a row expands it in place (`components/ChargerDetail.tsx`); tapping a charger dot on
either map does the same thing, after dismissing the map and scrolling the row to the middle
of the screen. One panel is open at a time, because each one carries a live Mapbox GL map and
a route can list hundreds of chargers.

The whole card used to be the maps deep link, on the reasoning that a small tap target is the
wrong answer in a car. That reasoning still holds — the summary is still one full-width
target — but it now opens the charger, and **Navigate** is a separate deliberate tap at the
bottom of the panel. Committing to a stop is the one action here you cannot undo once you are
driving towards it.

Four numbers answer whether to stop, and two of them are new:

| Row             | Where it comes from                                                    |
| --------------- | ---------------------------------------------------------------------- |
| Along the route | `alongDistanceM`, free on every charger, plus % of the trip            |
| From you        | **real road metres** from the Matrix — the "will the battery reach it" |
| Detour          | `detourS` as before, now with the extra kilometres alongside           |
| Left afterwards | **real road metres** from the charger on — "can this be the last stop" |

The two new ones are free. `priceDetours` already fetched `T(origin→charger)` and
`T(charger→dest)` and collapsed both into one scalar; the matrix now asks for
`annotations=duration,distance` instead of `duration` alone, and **Mapbox bills the Matrix
API per element, not per annotation**, so the distances arrive on a request that was being
made anyway. They are on the `driving` profile, like `detourS` and unlike the route's
traffic-aware headline — which is exactly why they are taken from the Matrix rather than from
a fresh Directions call. Mixing profiles is the bug this codebase warns about twice.

Rows past `ENRICHED_LIMIT` were never sent to the Matrix, so their two distance rows fall
back to route geometry — `alongDistanceM + offsetM` and `totalDistanceM − alongDistanceM` —
prefixed `≈` and never shown as measurements. Detour still reads `—`. Their charge points are
fetched on open, one request through the existing Worker route, keyed on the pipeline's own
enriched set so a top-20 row opened before its lookup lands does not duplicate a request
already in flight.

`offsetM` is also finally rendered here. It has been computed for every corridor charger
since the beginning and shown nowhere.

The panel's **Station** block is deliberately thin: one row, the opening hours, and only
when the live record actually reported them. Peak power, the free count, address, location
and operator all live on the card itself — the header, the badge and the footer — and repeating
them below the map only made the panel longer to scroll past to reach the charge points.
The per-point list is the reason to open the panel; the summary is the reason not to have to.

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
fields: [stationId, lat, lon, maxPowerKw, address, operator, location, points]

[83170, 47.64903, 15.85819, 50, "Schnellstraße 2, 2641 Schottwien, AT", "SMATRICS",
 "ENI Schottwien", [[50, 2]]]
```

Packed positionally rather than as named objects — 2,400 rows of `{"stationId":…}` would
triple the file and nothing reads these by name. The client unpacks in
`src/services/enbw/stations.ts`.

`location` is what a row is headed with — "ENI Schottwien", the name on the sign you are
looking for, rather than the street it stands on — and it is the one field here the
bounding-box query does not return at all. Only `/chargestations/{id}` carries it, so the
builder spends a second phase of one request per surviving station on it. That is the most
expensive part of the build by request count, and it buys a heading that is settled before
the app draws a row: it used to come from the live lookup, which meant a row changed its own
title a second after appearing, and again when its panel was opened.

EnBW packs several lines into that field — the site name, then access and parking prose — so
only the first line is kept, and a station that reports nothing falls back to the street part
of its address, which is what every row used to show.

Some stations put a notice where the name belongs, so the builder keeps a small blacklist
(`LOCATION_BLACKLIST`, currently just `Parkplatzverordnung`): a field containing one of those
words is prose about the car park rather than a place to look for, and the station takes the
address fallback instead. The match is case-insensitive and against the whole field, not only
the first line: sampled over 250 stations, every occurrence _was_ the first line, so nothing
is lost by being blunt about it. It catches 54 of 2,404 stations; another 2 answered nothing
at all, and those take the same fallback.

`points` is the station's charge points counted by power — `[[300, 4], [22, 4]]` for a hub
with four fast stalls and four AC posts beside them, fastest first, a `null` power for a
point EnBW reports none for. It exists because the power of a _station_ and the power of a
_point_ are different numbers: a hub is listed at 300 kW and keeps 22 kW posts, so a bare
point count says nothing about how many points the driver's Ladeleistung setting leaves.
Without it the app showed „4/8 frei" for a station where four of those eight were overnight
AC chargers. It comes out of the same detail response as `location`, and carries no statuses
— those change minute to minute and belong to the live lookup. Of the 13,063 points in the
current file, **1,202 are below 50 kW**: that is how many the old count included. See
`src/core/points.ts` for how the displayed count is derived.

It is also the station's **size**, and there is deliberately no separate total beside it.
File version 4 carried one, taken from the scan's `allChargePointCount`, and that field
counts only the points matching the `minPowerInKw` the query was made with — measured
against both endpoints, station 89607 answers 16 at ≥ 50 kW and 18 unfiltered, station
411145 answers 4 and 8. So a column named "total" held a 50 kW-filtered figure, which the
live record then overwrote with the real total: the badge's denominator grew the moment a
lookup landed. Version 5 drops it. Summed over the current file the two agree exactly —
13,063 points, 11,861 of them ≥ 50 kW, which is what the scan reported.

Because version 5 replaced that column rather than appending one, an older file does not
degrade — it mis-parses. `parseStationList` refuses anything below `MIN_LIST_VERSION` and
says to re-run the build, which is the right trade while the app is in testing and the file
ships with the code that reads it.

The list is the source of truth for **who a station is**. The live call is the source of
truth for **everything that changes**, and for the per-charge-point detail the list is too
small to carry. That split was learned the hard way: identity used to come from the live
call too, joined by station id, so any hiccup in that call left a row reading
`Station 2970018` with no address — see [EnBW renumbers stations](#enbw-renumbers-stations).
Identity has nothing to do with the network, so it no longer depends on it.

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

|                   | Requests | Upstream | Time    |
| ----------------- | -------- | -------- | ------- |
| 17 bounding boxes | 17       | 12 KB    | 1550 ms |
| 17 station ids    | 17       | 61 KB    | 1310 ms |

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

| Sample                         | 404 from `/chargestations/{id}` |
| ------------------------------ | ------------------------------- |
| 124 shipped ids in 2.90M–3.00M | **71**                          |
| 25 shipped ids below 2.90M     | 0                               |

That is 3.0% of the whole list, in four days. Each dead station had exactly one replacement
at the same position with the same power:

```
shipped 2970018,  50 kW  ->  live 3029234 @0m,  50 kW  "Cytastraße 1, 6176 Völs, AT"
shipped 2969949, 150 kW  ->  live 3029144 @0m, 150 kW  "Gewerbestraße 2, 3373 Kemmelbach, AT"
```

A re-issued id 404s, so that row shows `?/n` until the list is rebuilt. Because identity now
lives in the list, that is the _whole_ cost — the address, the power and how many points the
station has are still right. Before this change the same event blanked the row.

A position-based fallback (adopt a same-position, same-power record under a new id) was
considered and rejected: it would have restored the badge, at the price of keeping the
grouping and fuzzy-matching machinery alive to serve 3% of rows. Rebuilding the list takes
84 seconds.

### Is there a listing endpoint?

Effectively yes, on a different service. This was answered "no" for a long time, and the
answer was wrong in an expensive way.

`emobility-public-api` — the service behind EnBW's public web map — really does expose only
the bounding-box query and `/chargestations/{id}`. `?stationIds=`, `?ids=`, `/batch`,
`/status`, `/availability`, comma-joined ids and `POST` are all rejected. But the public web
map is not EnBW's only client. The Android app talks to **`emobility-complete`**, and its
`POST v1/mapsearch` answers the whole region at once:

```
POST .../emobility-complete/api/v1/mapsearch
     ?fromLat=45.7&toLat=55.1&fromLon=5.8&toLon=17.2
     &grouping=false&useFilter=true&maxResults=20000
```

with the filter in the JSON body. Both endpoints speak the same `stationId` namespace, so
this was a change to the build script and nothing else.

**`maxResults` is the parameter that matters.** The bounding-box query clusters — it divides
the box into an N×N grid and collapses any cell holding more than one station into a
placeholder carrying no station data — and the whole quadtree existed to split boxes until
the clustering stopped. It never needed to. Clustering is not a function of how large the box
is, it is a function of how many rows the answer would have, and `maxResults` caps that
number directly. A capped query does not cluster at all:

| Full area (DE + AT + CZ + northern IT) | Requests | Time      | Stations              |
| -------------------------------------- | -------- | --------- | --------------------- |
| Quadtree, `priceGroups` + `minPower`   | ~1,881   | ~2.8 min  | 2,404                 |
| No `maxResults`                        | 1        | 1.0 s     | 0 — 15 clusters       |
| **`maxResults=20000`**                 | **1**    | **1.0 s** | **2,438, 0 clusters** |

Verified equivalent rather than assumed: of the 2,404 stations in the previously shipped
list, 2,392 came back identical, the remaining difference being two days of real drift (15
added, 12 retired). Addresses, operator names, point counts and coordinates matched field
for field.

The body's `includeOtherOperators: false` replaces the old `priceGroups=ENBW_GROUP` query
parameter and selects the same set, and `minPowerInKw` replaces `minPower`. Both still
filter server-side, and the power floor is still applied a second time afterwards.

**The cap does not report itself.** Ask for 2,000 when 2,438 exist and the response is 2,000
stations with no clusters, no error and no flag — a silently half-built list, which for this
app means stations that simply never appear on a route. `assertNotTruncated` refuses to write
a file when the count reaches the cap, or when any cluster placeholder comes back at all.
That is why `MAX_RESULTS` sits at 20,000 against a real count of ~2,400.

Two phases became one request; the remaining cost is the per-station detail lookup for the
location line, which `mapsearch` does not carry. See
[What the list carries](#what-the-list-carries).

### How wide the scan has to be

One request also makes the question answerable, so it is worth recording the answer.
Querying the whole planet — `-90..90 x -180..180`, still one request — returns **2,438**
stations on this tariff at 50 kW and above, in Germany (1,952), Austria (301), Czechia (181)
and Italy (4), and nowhere else. They span **45.6035–54.8756°N, 6.0129–18.6677°E**.

The old scan box was 45.7–55.1 x 5.8–17.2, labelled "Germany + Austria + northern Italy",
and it silently dropped 31 of them: 30 across eastern Czechia — Ostrava, Olomouc, Zlín,
Havířov, out to 18.67°E — and the 400 kW, 16-point hub at Trezzo sull'Adda near Milan, at
45.60°N, a tenth of a degree below the southern edge. Czechia was not an oversight of scope;
151 Czech stations were already in the shipped list. The box just stopped partway through the
country, and nothing in the build could notice, because a bounding box has no idea what lies
outside it.

`DEFAULT_ROOT` is now 45.0–55.6 x 5.0–19.5, clearing the real network by 0.6°–1.0° on every
side. Widening costs one detail lookup per newly found station and nothing else — the scan is
a single request whatever the box is — so there is no reason to run it close to the edge.

## Route alternatives

Mapbox returns up to three routes (`alternatives=true`, no extra request cost). They are drawn
together on **one** Mapbox GL map — the chosen route emerald, each alternative in its own colour —
rather than as one thumbnail each. Side-by-side pictures cannot answer "which of these do I want":
the eye has to compare two images. Drawn together the shared trunk overlaps, so only the stretch
where they part company stands out, which is the only part the decision turns on. Under the map,
one row per route carries the road summary from `legs[].summary` — enough to tell "via SS44,
Jaufenpass" from "via A22" — plus distance, duration and penalty against the fastest, with a swatch
in the line's own colour. `components/routeColours.ts` is the single source for both, so a swatch
and the line it names cannot drift apart.

A route is picked by tapping its line or its row; tapping either re-places the corridor for it,
which is pure local geometry. The header's route summary opens the same map full screen, where
the question is no longer "which one" but "does this really go the way I think" — that one is
usually about a single junction or pass, so it needs zoom.

Two things a live map needs on a phone, both of which look like details and are not:

- **`cooperativeGestures` on the inline map.** It is embedded in a scrolling page, and a
  full-gesture map swallows the drag meant to scroll to the chargers below it — the page simply
  stops moving under your thumb. Two fingers pan the map; one finger scrolls the page. The
  full-screen sheet owns the viewport and turns this off.
- **Invisible hit layers.** The route lines are 3–5 px and the charger dots scale down to ~3 px at
  whole-trip zoom, so that a chain of them does not bury the very line they are strung along. Both
  are far below the ~44 px a fingertip actually covers, so tapping is served by separate
  transparent layers (`routes-hit`, `chargers-hit`) that are much fatter than what is drawn.

Chargers are drawn as GeoJSON circle layers, not DOM markers — a route can carry hundreds, and that
many absolutely-positioned elements fighting the map's own transform is what makes embedded maps
feel broken on a phone. Their colour carries the same three states as the list's availability badge,
including "no live data" as distinct from "none free". Tapping one dismisses the map and
opens that charger's row in the list below — see
[The charger detail panel](#the-charger-detail-panel). There used to be a Mapbox popup here,
built as an escaped HTML string because it is rendered outside React's root; the panel
replaced it outright, so there is one place a charger is described rather than two.

The geometry goes to the map exactly as Mapbox returned it. The previous static-image thumbnails had
to be Douglas–Peucker-simplified until the URL fit a character budget; a GL map has no such budget,
so there is no display simplification left to reason about.

### Detour is measured against the route point

Each charger is priced against **the spot on the selected route it sits beside**, not against the
whole journey. Both halves of the formula are the same trip asked twice — once ending at the
charger, once at the road beside it — so what is left is the excursion.

It used to be `T(origin→charger) + T(charger→dest) − T(origin→dest)`, which does not survive route
alternatives. Both legs are _unconstrained_: Mapbox routes them however it likes, so they are the
same numbers whichever alternative is selected, while `t_direct` is one fixed baseline. A charger
on the stretch two alternatives **share** therefore priced differently depending on which one was
selected — and since `maxDetourMinutes` hides rows above the cap, the same motorway station could
appear on one alternative and vanish on the other.

A re-baselining fudge (`routePenaltySeconds`, a whole-route constant subtracted when a slower
alternative was selected) made that worse rather than better: on the shared stretch you are on the
same metre of road either way, so no per-route constant can be right there. Anchoring on the route
point removes the question — for a shared stretch the route point is literally the same coordinate
on both alternatives, so the detour is identical by construction. The Jaufenpass case the constant
was there to fix works too: a charger on the pass has its route point on the pass, so the pass
costs it nothing.

It doubles the Matrix cost, because each charger now spends a coordinate slot on its route point:
12 chargers per request instead of 23, and `4k` elements for `k` chargers instead of `~2k`.

## Filters

The shipped list contains only stations on the EnBW tariff (`priceGroup === 'ENBW_GROUP'`), so
there is no provider filter at runtime — that selection happens offline, in the list builder.

**Why `priceGroup` and not `operatorCode`.** `DEEBW` is EnBW's _German_ operator code. EnBW runs its
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
at the source halves the file the phone downloads _and_ halves the geometry the corridor
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
badge already says `0/2 free` in red. There is no plug filter either: every station in the
list has CCS. The detail panel does list each point's actual connectors, which is where the
Typ 2 and CHAdeMO cables on the same stall become visible.

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
  disappeared shows as `?/n` rather than a wrong number, but a _new_ one simply will not appear.
- **Coverage depends on one offline run** — now literally one request, which makes silent
  truncation the failure mode to worry about. `maxResults` caps the answer without saying so,
  so the script refuses to write a file whose station count reached the cap, or that came back
  with any cluster placeholder at all. It prints its station count either way.
- **Only the EnBW network, and only its fast half** — 2,438 stations at 50 kW or above.
  The roaming network your card also works at is
  roughly 311,000 charge points in Germany alone, far too large to ship, and the tariff filter is
  what makes the EnBW slice cheap to enumerate in the first place. There is no widen-search escape
  hatch on routes where EnBW is thin.
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
- **Only the first 45 rows have live occupancy in the list.** Every row is fully described —
  name, address, power, its points and their powers, operator — straight from the shipped
  list. What the rows past `ENRICHED_LIMIT` lack is the live count, so they read `?/4` rather
  than `2/4 frei` — the denominator is right either way, because the points ship with the
  row. Opening one fetches its live record on the spot, so the panel is complete either way;
  the collapsed row is what stays `?/4` until then.
- **Detour is priced for the 20 nearest candidates only, and is never fetched on demand.** The
  "Away" and "Drive" columns are free — they come from projecting each charger onto the route
  polyline, so every charger in the corridor has them. Detour needs real driving times to and
  from a point off the route, which costs Mapbox Matrix quota. Rows past the first 20 show
  `—`, deliberately distinct from `on route` (measured, costs nothing), and their panel falls
  back to `≈` route-geometry distances. Unlike the EnBW lookup this is not fetched when a
  panel opens: one Matrix call per curious tap is a quota leak with no ceiling, and the
  geometry estimate answers the same question closely enough to judge a stop by.

  Because the list is in route order, those 20 are exactly the next 20 you will reach. Raising
  `ENRICHED_LIMIT` in `src/search/useRouteSearch.ts` is cheap: Mapbox bills per _element_ and the
  chunking sends `4k` elements for `k` chargers — the charger and its route point, each measured
  from the origin and on to the destination. At today's limit of 45 that is 180 elements per
  search, roughly 550 searches inside the 100,000-element monthly free tier.

- **Detour uses the `driving` profile**, not `driving-traffic`, because the traffic profile caps
  matrix requests at 10 coordinates instead of 25. The headline route ETA is traffic-aware; the
  detour delta is not.
- **Building the list** is a heavier one-off use of an undocumented API than per-route scanning
  was, though the station scan itself is now a single request. What remains is the per-station
  detail lookup: the script runs it at concurrency 4 and honours `Retry-After` on HTTP 429 with a
  shared cooldown across all workers. A full run trips the rate limit around the 2,200th station
  and waits it out; there is no resume, because a failed run now costs 84 seconds.
