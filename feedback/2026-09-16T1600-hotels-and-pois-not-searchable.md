---
status: discussed
---

# Hotels — and POIs generally — are not searchable

> Make hotels searchable

Destination search uses Mapbox Geocoding v6 forward (`geocoding.ts`), which has
no POI index. „Hotel Post Lermoos" returns **Motel Utca, Dabas, Ungarn** and the
town Lermoos. The premise holds.

**Scope widened in discussion:** not hotels, but a search box that behaves like
Google Maps — towns, addresses and POIs of every kind in one ranked list. So no
`poi_category` restriction.

## Decision: Search Box `/suggest` + `/retrieve`, replacing Geocoding v6

Search Box has two ways in and the cheap one is a trap. `/forward` is a single
request, needs no session token and returns coordinates directly — a drop-in for
`geocode()`. It is also tuned for brand and POI lookup, and destroys place
search:

| query          | Geocoding v6 (today) | Search Box `/forward`                                      |
| -------------- | -------------------- | ---------------------------------------------------------- |
| `Sankt Johann` | 6 distinct towns     | one street „St. Johann" with no address, one hotel in Prad |
| `Bozen`        | 6 distinct places    | Bozen, then 5 identical bus stops                          |

`types=` cannot rescue it: bus stops are `poi`, the same feature type hotels are.
`/suggest` is the interactive endpoint Mapbox's own search UIs use and ranks far
better, so the two-step it requires is the price of admission.

Geocoding v6 goes. One source, one code path, one ranked list. It still edges
`/suggest` on pure town disambiguation — for `Sankt Johann` it puts St. Johann in
Tirol first where `/suggest` puts it sixth — but not enough to justify two
requests per keystroke and a merge rule.

## `proximity` out, `origin` in

The parameter that matters, and the one today's code has wrong for this app.

- **`proximity`** biases _ranking_ toward a point.
- **`origin`** computes the `distance` field from a point and does **not** touch
  ranking.

`geocoding.ts:49` sends `proximity` = the driver's live position. In a long-range
app the destination is by definition far away — you would not need charging
otherwise — so biasing toward where you are boosts exactly the wrong things.
Searching „Bozen" from Munich spends four of six slots on Bozener Straße in
München, Ottobrunn, Dachau and Starnberg. „Sankt Johann" puts _Pfarrkirche Sankt
Johann Baptist, Valley, 31 km_ above every actual town.

With `origin` alone the list is the global-relevance one — the same places
Geocoding v6 returns today — and the local-street noise is gone.

POI search does not need `proximity` either: „Hotel Post Lermoos", „Gardaland"
and „Pizzeria Meran" return the same top hits with it and without it. Name
matching carries those; proximity was only ever helping queries that did not need
help.

Sending **neither** is not an option: Mapbox then falls back to IP geolocation for
`distance` and returns numbers from wherever the request appears to originate —
125 km for Lermoos where the true Munich figure is 97 km.

**Which, with the distance dropped, means sending no position at all.** `origin`
is ranking-neutral — `Sankt Johann` and `Pizzeria Meran` return byte-identical
lists for origin Munich, origin Hamburg and no origin — so its only effect is a
`distance` the rows do not show, and the IP fallback above corrupts a number
nobody reads.

So the search sheet takes no position input. `DestinationSearch` loses its
`proximity` prop (`App.tsx:213`) and the debounced effect depends on the query
string alone. This also removes a bug that exists today: `proximity` is the live
GPS position and a dependency of that effect, so with the sheet open in a moving
car it re-fires — and re-requests — every 50 m travelled (`useGeolocation.ts:44`
gates at 50 m), with no keystroke involved. On a motorway that is a request every
two seconds.

If distance is ever wanted, `origin` comes back pinned at sheet open, never
tracked.

## No category filtering, no dedupe

An earlier probe showed „Bozen" returning six identical bus stops and a category
blocklist was drafted against it. That was an artefact of the probe: `proximity`
had been set to a point _inside_ Bozen, so stops 271–878 m away were
near-perfect matches. Under a realistic origin the noise does not occur. No
filter ships; if the tester hits a bad list in the car, a blocklist can be added
then against a real example. `poi_category_ids` carries canonical English ids
(`bus_stop`, `transportation`) independent of `language=de`, so that stays cheap
to do later.

## Rows: icon, name, context — no distance

Suggestions carry `maki` (`marker`, `lodging`, `restaurant`, `bus`, `building`),
which gives a per-type icon for free. A hotel and a town currently look identical
in the list.

**No distance**, though it is free in the payload and needs no extra request. It
is great-circle: Munich → Bozen reads 183 km where the road is roughly 300. Every
other kilometre in the app is a road figure — „Auf der Route", „Zur Ladestation",
the route total — and a crow-flies number with no cue that it is one is
misleading. `eta_type=navigation` + `navigation_profile=driving` was tried and
returns `eta: null` on this token, so there is no road figure to be had here.

## Implementation

`@mapbox/search-js-core` — headless, no UI, so `DestinationSearch.tsx` keeps its
own Tailwind markup. Its `SearchSession` owns the session-token lifecycle, which
is the part that silently costs money: the token must be created once per search
and reused across keystrokes, rotating only after a pick. One token per debounced
keystroke turns the 500 free sessions a month into about 100 searches.

Knock-on changes:

- `/suggest` returns no coordinates, so `onPick` becomes async and `Place` gains
  an unresolved state — a suggestion is a `mapbox_id` until `/retrieve` runs.
- A new failure path: the user taps a result and `retrieve` fails.
- Recents are unaffected once resolved, since they store coordinates.
- Billing moves from requests (100,000/month free) to sessions (500/month free,
  introductory). Both are far beyond one driver's use.

**Parked, to be checked separately:** Mapbox's storage terms. The app is on
temporary geocoding and persists `recentDestinations` to localStorage via zustand
`persist` (`store.ts:48`); Search Box is stricter still, with no permanent option
under standard terms.
