---
status: implemented
---

# „5 % der Strecke" is useless

Sub-line of the „Auf der Route" cell (`ChargerCard.tsx:131`), from
`formatProgress`. The numerator is the distance printed directly above it and
the denominator is the route total the sticky header already shows
(`App.tsx:98`), so the line spends a third of the card's densest row restating a
division of two figures that are both on screen.

Nothing decides on it either. The list is already sorted by along-distance
(`corridor.ts:133`) and a percentage is monotone in that, so it neither reorders
rows nor thresholds them — the questions a driver asks (does the battery reach
it, what does the detour cost, is a fast post free) are answered by the other
two cells and the badge. Its resolution is inverted on top of that: at 620 km
one percent is 6.2 km, so the near field the driver is actually choosing between
collapses into „0 %"…„2 %", while a station 300 km out gets a precise „48 %".

A fourth argument was that it would break under the scroll-position item — the
numerator becoming `alongDistance(station) − alongDistance(you)` while the
denominator stayed the route's own fixed total, so a station holding steady
20 km ahead would decay toward „0 %". That one has since expired: that item's
work passes the _remaining_ distance down (`App.tsx`, `remainingDistanceM`),
so both figures share the driver's origin again and the percentage would have
stayed arithmetically honest. The three arguments above carry the decision on
their own.

**Decision: drop the percentage.** The sub-line becomes the travel time alone,
`formatProgress` and its tests go with it, and the wording item loses its
„Strecke" occurrence here.

Considered and not taken: an arrival clock („10 min · an ca. 14:20"), which is
real information — opening hours, break planning — but an absolute time reads as
wrong when stale where a relative „10 min" does not, so it needs a ticking now
and deserves its own item rather than a free ride on this one. Also considered:
promoting the panel's „Weiterfahrt zum Ziel" into the row, which is the range
figure a driver does act on, but it is too long for three columns on a phone and
duplicates the panel's own headline.

Noted while reading: `formatProgress` clamps to 0…100, the same swallowing of
snapping noise the detour item objects to, and its doc comment still claims
only the detail panel reads it. Both went with the function.

**Implemented:**

- The „Auf der Route" sub-line is `formatDuration(item.alongDurationS)` alone.
- `formatProgress` and its four assertions are gone; nothing else called it.
- `remainingDistanceM` stays in the prop chain — `ChargerDetail` derives
  „Weiterfahrt zum Ziel" from it, so only the percentage's use of it went.
