# Ladestopp — EnBW chargers along your route

A mobile-browser SPA. Enter a destination and get a ranked list of chargers along the
route, each showing how far away it is (km and minutes), how much detour it costs
(minutes), and how many charge points are free right now. Tapping a charger hands off
to Apple or Google Maps. Your last destination is remembered, so reopening the app
mid-trip picks up where you left off.

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
token would be published. `src/routing/mapbox.ts` refuses anything that does not start
with `pk.`.

Because the token is public, **URL restrictions are the actual security control**. Add
`http://localhost:5173/*` and your deployed origin in the token settings. Note that URL
restrictions are incompatible with Mapbox's *native* SDKs — fine for this browser SPA,
but it would break if you ever wrapped it in a native shell.

**2. EnBW subscription key** (charger data and live availability)

EnBW has no official public API. The app uses the undocumented endpoint behind
EnBW's own charger map, which needs the same subscription key that map sends.
To find it: open <https://www.enbw.com/elektromobilitaet/produkte/mobilityplus-app/ladestation-finden/map>,
open DevTools → Network, and read the `Ocp-Apim-Subscription-Key` request header
on any `chargestations` call.

```bash
echo 'ENBW_SUBSCRIPTION_KEY=<the key>' > .dev.vars   # local dev
pnpm wrangler secret put ENBW_SUBSCRIPTION_KEY       # production
```

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

```bash
pnpm test        # unit tests, hermetic and offline
pnpm typecheck   # app + worker
pnpm build       # production bundle
```

Deploy: `pnpm deploy:worker` for the API, and any static host for `dist/`.

## Why a proxy

EnBW's gateway *looks* browser-callable — the CORS preflight answers
`access-control-allow-origin: *` and allows the subscription-key header — but the
actual GET is gated on the `Origin` header:

```
Origin: https://www.enbw.com   -> 200
Origin: http://localhost:5173  -> 403 forbidden
```

Browsers set `Origin` themselves and JavaScript cannot override it, so the call has
to happen server-side. `worker/index.ts` does that, and also fans out the corridor
tiles so a phone on a slow connection makes one request instead of dozens.

## How it works

1. **Route** — Mapbox Directions (`driving-traffic`) with `annotations=distance,duration`.
2. **Corridor scan** — the route is sampled every ~4 km and each sample becomes a
   bounding box. EnBW returns *cluster placeholders* instead of stations when a
   bbox is too large (measured: a 0.15° box gave 130 clusters out of 161 rows; a
   0.01° box gave 11 real stations out of 13), so tiles are kept small and the
   Worker subdivides any tile that still clusters.
3. **Distance and time** (`src/routing/corridor.ts`) — each charger is projected onto
   the route polyline and read off the cumulative annotations. Zero API cost, so
   every charger in the corridor gets these figures.
4. **Detour** (`src/routing/detour.ts`) — `T(origin→charger) + T(charger→dest) −
   T(origin→dest)`, from two Mapbox Matrix calls per 23 chargers.

   `t_direct` is deliberately read from the *same* matrix call (by appending the
   destination as an extra target) rather than reused from step 1: the route uses
   `driving-traffic` and the matrix uses `driving`, and subtracting across profiles
   yields nonsense, routinely negative.
5. **Filter and hand off.** The list is always in **route order** — the order you
   drive past them. There is no sort control: `placeChargersOnRoute` orders by
   along-route distance and nothing downstream re-orders, which is also what makes
   the detour cap below honest.

## Filters

`Settings → Which stations`, narrowest first:

| Setting | Predicate |
|---|---|
| EnBW network *(default)* | `priceGroup === 'ENBW_GROUP'` |
| Works with my EnBW card | `authenticationMethods` includes `MOBILITY_PLUS_CHARGE_CARD` |
| All stations | — |

**Why `priceGroup` and not `operatorCode`.** `DEEBW` is EnBW's *German* operator code.
EnBW runs its own network abroad under separate entities — `ITSMA` (SMATRICS EnBW
Italia), `ATSMA` (SMATRICS Austria) — and has German subsidiaries such as `DEODR` and
`DESMA`. All of them bill at `ENBW_GROUP`. Measured over 801 stations across five
countries, `operatorCode === 'DEEBW'` matched 74 and `priceGroup === 'ENBW_GROUP'`
matched 79; every `DEEBW` station carries `ENBW_GROUP`, so the price group is the same
set plus the ones the operator code wrongly dropped — including a 400 kW site in South
Tyrol. Filtering on the operator code made the app useless outside Germany.

Default minimum power is 50 kW. Narrow filters can return a short list, so when
fewer than three chargers match, the list offers a one-tap widen to the next filter.

## Testing against live data

`pnpm test` never touches the network. There is an opt-in integration check that runs
real EnBW data through tile generation and route projection (no Mapbox token needed —
it uses a hand-built A8 polyline):

```bash
pnpm dev:worker
SMOKE=1 pnpm vitest run src/routing/liveSmoke.test.ts
```

## Known limitations

- **The EnBW endpoint is undocumented.** It can change, the key can rotate, and the
  `Origin` gate could tighten. A 403 from the Worker almost always means one of those.
  `ChargerProvider` in `src/providers/types.ts` is the seam for adding a fallback
  source such as Open Charge Map (official and documented, but no live availability).
- **Availability is a snapshot**, seconds to minutes stale, and a free point can be
  taken before you arrive. The header shows when the data was fetched.
- **Detour is priced for the 20 nearest candidates only.** The "Away" and "Drive"
  columns are free — they come from projecting each charger onto the route polyline,
  so every charger in the corridor has them. Detour cannot be derived locally: it needs
  real driving times to and from a point off the route, which costs Mapbox Matrix
  quota. Rows past the first 20 show `—`, which is deliberately distinct from
  `on route` (measured, costs nothing).

  Because the list is in route order, those 20 are exactly the next 20 you will reach.
  Raising `PRICED_LIMIT` in `src/hooks/useRouteSearch.ts` is cheap if you want more:
  Mapbox bills per *element* (one source→destination pair) and the chunking sends
  `2k+1` elements for `k` chargers, so 20 chargers is 41 elements per search — roughly
  2,400 searches inside the 100,000-element monthly free tier. The real cost of raising
  it is latency, since chunks run sequentially.
- **Detour uses the `driving` profile**, not `driving-traffic`, because the traffic
  profile caps matrix requests at 10 coordinates instead of 25. The headline route ETA
  is traffic-aware; the detour delta is not.
- **Single-stop navigation handoff.** Google supports chaining charger → destination
  via `waypoints=`, but Apple has no reliable multi-stop URL scheme, so both send
  just the charger.
