---
status: implemented
---

# Point count „4/8" ignores the power filter

> Anzahl der Ladepunkte (4/8) berücksichtigt Filter nicht und beinhaltet 22kwh Lader

`AvailabilityBadge` renders EnBW's station-level `availableChargePoints` /
`numberOfChargePoints` (`worker/index.ts`), which count every point at the
station including 22 kW AC posts. `applyStaticFilters` only decides whether the
_station_ is listed, by its `maxPowerKw`; it never touches the count.

**Decision:** count only points whose own power is ≥ the Ladeleistung setting.

Open was: rows past `ENRICHED_LIMIT` (45) and stations EnBW did not answer for
have `chargePoints: null`, so there is no per-point data to filter.

## Resolved: the shipped list now carries the powers

The generator's phase 2 already spends one `/chargestations/{id}` request per
station on the location line, and that response carries `chargePoints` too — it
was being parsed for `additionalInfo` and thrown away. So the list ships a
per-power point count (`points`, file version 5) for **no extra request**, and
the denominator is correct on every row rather than only on the enriched ones.
A row with no live record now filters at whatever the setting is, not just at
the 50 kW the file happens to be built to (see the finding below); the free
count still needs the lookup, the station's size as filtered does not.

## Finding: the shipped point count was never the station's size

Measured against both endpoints while checking the generated file. The bulk
query's `allChargePointCount` **follows the `minPowerInKw` it was asked with**:
station 89607 answers 16 at ≥ 50 kW and 18 unfiltered, station 411145 answers 4
and 8. The detail endpoint's `numberOfChargePoints` is the unfiltered total and
equals the length of its `chargePoints` array.

So `totalPoints` in the shipped list has always been "points at ≥ 50 kW", while
the live record overwrote it with the true total. That is where the tester's
„4/8" comes from: 4 was the shipped count, 8 arrived with the live record, and
the denominator silently grew the moment the lookup landed.

**`totalPoints` is therefore gone** — from the packed row, from `Charger`, from
`LiveStation` and from the Worker's reply. A station's size is the sum of its
`points`, which is one number from one source instead of two that disagreed. A
station whose detail lookup failed during the build has no points at all and its
badge reads „?": EnBW's station-level counts are not a fallback, they are the
numbers this change exists to stop displaying.

Checked against the rebuilt list: all 2436 stations report their points, the
listed `maxPowerKw` equals the station's own fastest point for every one of
them, and no station is listed at a setting none of its points reaches — so the
"nothing matched" branch is unreachable with real data and only covers the two
endpoints contradicting each other.

**Implemented:**

- `core/points.ts` — `matchingPoints(charger, minPowerKw)`, the one place the
  displayed count is derived. Live record (power + status per point) → both
  numbers; shipped powers → the denominator, with the station-level free count
  kept only when the setting excludes nothing, since EnBW says how many points
  are free and never which; neither → „?" for both.
- Unknown power counts, exactly as `applyStaticFilters` keeps a station of
  unknown power.
- The map dot colours by the same number (`chargerFeatures`), or a green dot
  would sit over a „0/4" badge.
- The detail panel lists every group and mutes the excluded ones, with the
  threshold named once in the heading: „Ladesäulen (4 von 8 ab 50 kW)".
- `parseStationList` refuses a file below `MIN_LIST_VERSION` (5). Version 5
  replaced a column rather than appending one, so an older file does not
  degrade — it would read the old point count as the operator name and shift
  every field after it. No migration, by choice: the file ships with the code
  that reads it.
- `public/stations.enbw.json` rebuilt: 2436 stations, 13,063 points, **1,202 of
  them below 50 kW** — that is how many the old badge was counting. 677 KB raw,
  116 KB gzipped (was 445/109).
