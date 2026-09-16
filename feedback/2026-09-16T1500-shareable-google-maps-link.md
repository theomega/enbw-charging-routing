---
status: implemented
---

# Shareable Google Maps link

`navigationUrl()` is only an `<a href>`, on the „Hierhin navigieren" button
(`ChargerDetail.tsx:161`). iOS Safari does offer long-press → „Link kopieren",
so the URL is technically reachable, but it is undiscoverable and it is a
long-press on the one control whose short press launches turn-by-turn. And under
„Automatisch" on an iPhone `isApplePlatform()` is true, so what you would copy
is `maps.apple.com/?daddr=…`: the Karten-App setting answers "which app should
_this_ phone open", which is not a question the recipient's phone is asking.

## Decision: a second affordance, place links, provider picked per share

„Hierhin navigieren" is untouched and keeps following Karten-App. A chevron
segment attached to its right opens a two-item menu, „Google Maps Link teilen"
and „Apple Maps Link teilen". The driver chooses the provider per share, because
only they know what the recipient carries — `mapsApp` never reaches the shared
URL.

Both share the station **as a place**, not a route to it. A directions link
bakes in „von deinem Standort", and the recipient is usually not the person
driving our route.

## Measured: Google cannot label a coordinate pin, Apple can

Tested against the live clients on 2026-09-16, desktop UA and an
Android/Pixel-emulated mobile UA, because the docs answer none of this.

The legacy labelled form was the reason to consider leaving `api=1` behind, and
it does not work: `www.google.com/maps?q=48.4131,9.9526(Seligweiler)` redirects
to `/maps/place/48°24'47.2"N+9°57'09.4"E/@48.4131,9.9526,17z/…` and the name
appears nowhere in the rendered page. The pin is exact, the parenthesised label
is discarded — behaviourally identical to the documented form, minus the
documentation.

Google also disclaims it: „If `api=1` is _NOT_ present in the URL, all
parameters are ignored and the default Google Maps app will launch." On web
`q=` is in fact still honoured for coordinates, but the untestable path is the
one that matters — on iOS and Android the URL is claimed by the Google Maps app
as a universal/app link, and „all parameters are ignored" there means the
recipient opens Maps at their _own_ location with no pin at all. Failure by
documented design, so a future app release is entitled to start doing it.

The labelled path form is worse than useless:
`www.google.com/maps/place/Seligweiler/@48.4131,9.9526,17z` — the shape Google's
own share links take — resolved to „Seligweiler, Elchingen" at 48.4566, 10.0356.
It geocoded the _name_ and threw our coordinates away, ~9 km off. For a charging
station that is a wrong destination, not a cosmetic defect.

The only supported labelled Google form is
`query=<name>&query_place_id=<id>`, and a place id needs a billed Places API
call. The app has no Google key.

Apple has the feature outright, and it is documented: „A custom name to use for
the place card… when dropping a pin".
`maps.apple.com/place?coordinate=48.4131,9.9526&name=Seligweiler` rendered as
„Seligweiler" at the exact coordinates with a reverse-geocoded
„Kelternweg 124, 89075 Ulm" — **in Chrome under an Android UA**, so the Apple
link is not a dead end for a recipient on Android.

| Provider | Link                                                 | Pin label       | Exact coords |
| -------- | ---------------------------------------------------- | --------------- | ------------ |
| Google   | `maps/search/?api=1&query=48.4131,9.9526`            | ✗ coordinates   | ✓            |
| Apple    | `maps.apple.com/place?coordinate=…&name=Seligweiler` | ✓ „Seligweiler" | ✓            |

The asymmetry is Google's, not a choice open to us. It is also what makes the
share _text_ load-bearing rather than decorative: for the Google link the
message body is the only place the recipient learns which station this is.

## Implemented

- **Links:** `googlePlaceUrl` and `applePlaceUrl` beside the existing pair in
  `nav/deepLinks.ts`.
  `appleMapsUrl`/`googleMapsUrl` stay as they are and remain the navigation
  pair, so the green button's behaviour does not move. `name` finally gets read
  by something — it sits in both existing `Pick<>`s and neither uses it.
- **Apple form:** the unified `place?coordinate=&name=`, not the legacy
  `?ll=&q=`. Apple's servers do upgrade the legacy form into the unified one —
  watched it redirect — and that would have covered iOS below 18.4, which the
  unified path does not: the labelled place card needs the _recipient_ on
  iOS 18.4+ / macOS 15.4+ and is undocumented below that. Traded deliberately,
  for not depending on a redirect Apple never promised.
- **Apple parameters:** `coordinate` + `name` only. `/place` accepts `address`
  too, but Apple reverse-geocodes it unprompted and the address is in the
  message text anyway.
- **Payload:** `title` = station name, `text` = „Seligweiler, Kelternweg 124,
  89075 Ulm", `url` = the chosen link, with the address dropped from the text
  where `Charger.address` is null. No availability figures: „4 von 8 frei" is
  already wrong by the time the message is read, and a shared link outlives a
  Refresh in a way the badge does not.
- **Mechanism:** `navigator.share` only, no clipboard path. The chevron itself
  is hidden when `navigator.canShare(payload)` is false, rather than opening an
  empty menu — so the disclosure does not exist in desktop Firefox, and testing
  wants a phone or Chrome/Safari. `share()` must be called synchronously in the
  tap handler (transient activation) and rejects with `AbortError` when the
  sheet is dismissed, which is swallowed, not surfaced.
- **To verify on the tester's phone:** several share targets accept `text` or
  `url` but not both and drop one silently. If WhatsApp loses the link, the URL
  is appended to `text` as well.

**Left to do:** one pass on the tester's iPhone. Chrome on Linux has no share
sheet, so `canShare` is false there and the chevron does not render at all — the
split button's layout and the WhatsApp payload question above have not been seen
on a device that can show them.

**Out of scope, deliberately:** a permalink back into this app with the
destination and station preselected. Nothing in `src/` touches
`URLSearchParams`, `location.hash` or `history`, so that is a feature and not a
link format — its own item. This one is about handing one charger to a person.
