---
status: implemented
---

# „Route" vs „Strecke"

Two UI occurrences, and only one of them is this item's.

The first is the route-percentage item's sub-line (`ChargerCard.tsx:131`,
„… der Strecke"), which that item deletes outright. Left alone here so the two
items do not both edit the same line.

The second is the real one: „Für diese Strecke wurde keine Route gefunden."
(`directions.ts:59`) names one thing with both words in one sentence. Renaming
„Strecke" → „Route" makes it circular, because the thing that has no route is
not a route — it is the trip that was asked for.

**Implemented:** „Für dieses Ziel wurde keine Route gefunden." The destination
is what the driver picked, and „Ziel" is already the app's word for it
(`App.tsx:184`, `DestinationSearch`).

Everything else already follows CLAUDE.md: „Auf der Route", „Ladestationen
entlang der Route", „aus der Route geschätzt", „Route im Vollbild anzeigen".

**Decided against:** letting the German text win over Mapbox's `message`. The
string stays the `??` fallback, so in practice the driver usually sees Mapbox's
English („No route found", „Route exceeds maximum distance limitation") rendered
verbatim by `ChargerList.tsx:69`. Those carry detail our one sentence cannot, and
losing it to have German is the worse trade.

**Struck from this item:** the claim that the code says „Ladepunkte" while
CLAUDE.md says „Ladesäulen". `grep -i ladepunkt` over `src/`, `worker/` and
`scripts/` returns nothing — the code says „Ladesäule(n)" throughout and matches
CLAUDE.md. The confusion is commit `ebea2f5`, whose message reads „REname
Ladesäulen -> Ladepunkte" while its diff does the opposite.
