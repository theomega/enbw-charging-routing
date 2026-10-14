---
status: implemented
---

# Ladestation-Marker auf der Übersichtskarte sind auf dem Handy schwer zu treffen

> The charging station markers on the overview map are hard to click on mobile screens because they are quite small.

## Analysis

Chargers are not DOM markers — they are a Mapbox GL `circle` layer, `chargers-dots`
(`src/components/RouteMap.tsx:176-190`), fed by `chargerFeatures()` in
`src/components/mapFeatures.ts:56-71`. `RouteMap.tsx` is a single shared component
used by three call sites, so there is no separate "overview" definition:

- `RoutePicker.tsx:68` — the inline overview map
- `RouteMapSheet.tsx:55` — the full-screen overview map
- `ChargerDetail.tsx:117` — the single-charger detail map

The visible dot radius is zoom-interpolated, not fixed: 2.5px at zoom 5, 4px at zoom
9, 6px at zoom 13 (`RouteMap.tsx:185`), with stroke width 0.5px→1.5px
(`RouteMap.tsx:187`). The comment above it says this scaling exists so dots along a
long route don't merge into one chain at low zoom — it is not about tap size.

Tapping already goes through a separate, invisible, larger hit layer rather than the
visible dot: `chargers-hit` (`RouteMap.tsx:194-199`) is a `circle-opacity: 0` layer
with a flat `circle-radius: 14` (px), independent of zoom. Click handling is Mapbox's
built-in `map.on('click', 'chargers-hit', …)` feature query
(`RouteMap.tsx:212-215`), not custom hit-testing, so there's no separate tolerance
value to tune elsewhere.

The route line has the same pattern and its own comment states the reasoning
explicitly: `routes-hit` (`RouteMap.tsx:164-170`) is a 24px-wide invisible line
because "a 3 px line is far below the ~44 px a fingertip actually covers." The
charger hit layer's own comment (`RouteMap.tsx:191-193`) makes the identical
argument for chargers ("a dot no thumb can hit... same answer as the route lines")
but lands on a 14px **radius**, i.e. a 28px-diameter tap target — smaller than the
~44px the sibling comment cites, and smaller than the diameter the route line
actually uses (24px width, i.e. also under 44px, but chargers are further still).

No CSS media queries, `devicePixelRatio` handling, or other mobile-specific sizing
exist anywhere in the map code (`grep` across `src` for
`devicePixelRatio|matchMedia|@media` is empty) — the zoom interpolation above is the
only size variation, and it isn't keyed to device or viewport.

So: the report matches the code. The visible dot is small by design (route
readability at low zoom), and there is already a fattened invisible tap layer meant
to compensate — but that layer's radius (14px) was set below the fingertip figure
its own neighboring comment cites, rather than derived from it.

**Decision: leave the sizes as they are.** With the analysis above in hand the
current target was judged good enough in practice: the 28 px circle is what the
thumb actually lands on, not the 5-12 px dot that prompted the report, and the
dot's smallness is a deliberate trade for route readability at low zoom. Nothing in the code changes, and the 14 px radius stands as the
agreed value rather than as an unexamined one.

Considered and not taken: raising `chargers-hit` to a 22 px radius so the
diameter meets the ~44 px its neighbour comment cites. Along a route the
stations are strung close together, and the hit circles already touch at low
zoom; widening them makes neighbours overlap further, and the handler takes
`e.features?.[0]` — so the cost of a bigger target is not a missed tap but a
tap that silently opens the wrong station, which reads as a bug where a miss
reads as a miss. The 44 px figure also transfers badly from the route line:
a line is missed in one dimension, a dot in two, but a line has no neighbour
competing for the same pixels.

Also considered: enlarging the visible dot on touch devices, via
`matchMedia('(pointer: coarse)')` or `devicePixelRatio`. That reopens exactly
the overlap the zoom interpolation exists to prevent, and would make the map
look different on the two screens it is compared on, for a tap target that is
already larger than the dot either way.

**Implemented:** no code change. `chargers-dots` and `chargers-hit`
(`src/components/RouteMap.tsx`) keep their current radii.
