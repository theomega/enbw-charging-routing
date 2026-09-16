---
status: implemented
---

# „0 m extra" when the station is a shortcut

`detourCost` clamps negatives to 0 for seconds and metres independently, to
swallow route-point snapping noise. It also flattens genuine shortcuts, and the
row then reads „kein Umweg · 0 m extra" — a figure the app never measured.

## The clamp was only half of it

Two more things hid the sign, and the clamp is the one that mattered least.

`formatDetour` maps anything rounding to ≤ 0 min onto „kein Umweg", so lifting
the clamp alone would not have changed the value cell: a genuine −4 min still
read „kein Umweg". And `formatDistance` had no negative branch at all — every
branch tested the signed value, so any negative fell into the first one and
−12 400 m printed „-12400 m" rather than „12 km", while −4 m printed **„0 m"**
(`Math.round(-0.4) * 10` is `-0`, which stringifies to `0`). The fabricated zero
the tester saw had two independent ways to appear.

## What a negative actually means

Not that the station is a shortcut. Leaving the road, driving to a charger and
rejoining cannot be shorter than staying on the road — so a negative says the
baseline leg did not take the road the driver will:

- **Profile mismatch.** The geometry is a `driving-traffic` route while all four
  matrix numbers are `driving` (`matrix.ts:39`, deliberately — `driving-traffic`
  caps the matrix at 10 coordinates). The route point therefore sits on the
  traffic-optimal path while `origin → routePoint` is priced free-flow optimal.
- **A non-fastest alternative.** Both legs are unconstrained, so on a slower
  alternative they price the fastest route instead. The negative is then real
  information — but about the route choice, not about the station.

So „snapping noise, tens of seconds" understated it. The detour is a few minutes
extracted as the difference of two multi-hour journeys, and wherever the network
offers two comparable long paths their disagreement can exceed the quantity
being measured. There is no bounded noise floor to clamp against.

## Decision: show the sign, at the measured magnitude

Not „don't print what wasn't measured" (keep „kein Umweg", drop the sub-line),
and not „report it as unmeasured". A negative is exactly as honest as the
positives beside it — same arithmetic, same four numbers — and absorbing it made
a route artefact indistinguishable from a station that genuinely costs nothing.
Shown, it is at least visible.

No deadband. „Keep the actual value, do not clamp it": a −4 m detour reads „4 m
weniger" and not „0 m", because that zero is the whole complaint.

**Implemented:**

- `detourCost` returns the subtraction. The comment that justified the clamp is
  replaced by the two causes above, plus the excursion note below — it is the
  only place a reader will look.
- `formatDetour` gains „4 min weniger". Sub-minute keeps „kein Umweg" at either
  sign: minutes are that cell's unit, and a rounded _verdict_ stays true where a
  rounded _number_ does not. That distinction is the whole difference between
  „kein Umweg" and „0 m".
- `formatDistance` formats the magnitude and gains a sub-10 m branch, so it
  never renders a measurement as „0 m" — which also fixes „0 m extra" for a
  +4 m detour. Safe to drop the sign there because the detour is the only signed
  figure in the app: `aheadOfDriver` and `remainingRoute` clamp every
  along-route number at zero where they compute it (`core/progress.ts`).
- `formatDetourDistance` carries the sign in the word — „2,4 km extra" against
  „560 m weniger" — and keeps `ChargerCard`'s sub-line a single call.
- Untouched, because both already admit negatives: the `detourS <= 300` emphasis
  and `filterByDetour`'s `<= capS` (`filters.ts:51`). `DetourCache` stores the
  arithmetic's output, so nothing cached needed invalidating.

## Not taken: measuring the excursion locally

`routePoint → charger → routePoint` is what the column claims to measure. It is
non-negative by construction, it never leaves the selected route, and it is
independent of origin _and_ destination — so it would be priced once per route
rather than re-spending ~8 Matrix requests every 2 km as `useDetours` does now,
since the origin would leave the arithmetic entirely. The origin and destination
legs would still be fetched for „Zur Ladestation" and „Weiterfahrt zum Ziel",
but the route-point coordinates — which exist _only_ for the detour — would
leave those queries.

Parked rather than rejected: it changes what the app measures, which is a larger
question than the sub-line this item is about. If the signed figures read badly
in the car, that is the item to open, and it is now visible enough to judge.
