import { SearchBoxCore, SessionToken, type SearchBoxSuggestion } from '@mapbox/search-js-core'
import type { Place } from '../../core/types'
import { MapboxError, requireToken } from './client'

/**
 * Destination search: Mapbox Search Box, `/suggest` then `/retrieve`.
 *
 * Two calls rather than one because only `/suggest` ranks places properly.
 * `/forward` answers in a single request and needs no session, but it is tuned
 * for brands and POIs: „Sankt Johann" comes back as one street and a hotel in
 * Prad instead of six towns.
 *
 * The two steps are billed as one *session* rather than as two requests, which
 * is why the token lives here and not in the component: one token is made per
 * search, reused across every keystroke, and rotated only by a completed pick.
 *
 * The library also ships a `SearchSession` wrapper that automates exactly
 * that, and it cannot be used: its `suggest()` promise never settles once a
 * request has been superseded mid-flight, which is what typing does. Its event
 * bus iterates a live listener array while each one-shot listener splices
 * itself out of it, and an aborted call never fires, so the stale listener
 * stays at index 0 and pushes the live one past the end of the loop. The
 * symptom is „Suche läuft…" forever on a query typed with a pause in it.
 * `SessionToken` is the half of the wrapper that works, and the rotation it
 * leaves to the caller is one line.
 */

/**
 * Mapbox's maximum, and worth asking for in full because the refinement rows
 * below are dropped after the API has already counted them: „Hotel" returns
 * ten and shows seven, where six returned showed three. Nothing is billed by
 * result count — a session counts `/suggest` calls, not what they answer with
 * — and the larger response is about 3 KB.
 */
const LIMIT = 10

/**
 * Null Island, and the only way to switch proximity ranking off.
 *
 * Omitting `proximity` does not mean "no bias" — the API documents IP
 * proximity as its default, and that biases the *ranking*, not merely the
 * `distance` field. Measured from a Berlin address, „Bozen" returned Bozen and
 * then five Berlin businesses: MOA Bogen, BODENHAUS, Glischke Parkett. For a
 * car about to drive 300 km, places near the phone are the least likely
 * answers.
 *
 * Mapbox documents no value that disables the bias, so it has to be aimed
 * somewhere harmless. 0,0 is open ocean 500 km off Ghana: biasing towards it
 * cannot promote anything, and the list becomes the global-relevance one —
 * „Bozen" returns Bozen, Bözen, Bozeni, Bożeń. Queries that match on a name
 * never cared either way; „Pizzeria Meran" returns the same four Italian
 * results with it and without it.
 */
const NO_PROXIMITY = '0,0'

/**
 * Feature types that are a search refinement rather than a place.
 *
 * `/suggest` mixes them in: „Hotel" answers with „Hotel" and „Motel" typed
 * `category`, and „Hotel Indigo" typed `brand`, above the actual hotels.
 * Mapbox intends them to be tapped to narrow the search, which needs either
 * `/category` or a second `/suggest` — and both rank around a location this
 * sheet deliberately does not send.
 *
 * Retrieved instead of re-suggested, a category answers HTTP 200 with zero
 * features, and a brand answers with several: „Hotel Indigo" yields one Madrid
 * and two Barcelona hotels, among which nothing here could choose. Neither can
 * become a destination, so neither is offered.
 */
const REFINEMENT_TYPES = new Set(['category', 'brand'])

/**
 * Preferred label language, e.g. "de" from "de-DE". Only the primary subtag is
 * sent; Mapbox falls back to local names when it has no translation.
 */
export function preferredLanguage(tag?: string): string {
  const raw = tag ?? (typeof navigator !== 'undefined' ? navigator.language : '')
  const primary = raw?.split('-')[0]?.toLowerCase()
  return primary && /^[a-z]{2,3}$/.test(primary) ? primary : 'en'
}

/**
 * One row of the picker, and deliberately not a `Place`: a suggestion is a
 * `mapbox_id` until `/retrieve` has run, so it has no coordinates to offer and
 * nothing may store it.
 */
export interface Suggestion {
  id: string
  name: string
  /** Second line — the town and country, or the street for a POI. */
  context: string
  /** Mapbox's administrative type, e.g. "place", "address", "poi". */
  featureType: string
  /** Mapbox's icon name, e.g. "lodging". Null where it sends none. */
  maki: string | null
  /** What `/retrieve` wants handed back. Opaque above this file. */
  raw: SearchBoxSuggestion
}

function toSuggestion(raw: SearchBoxSuggestion): Suggestion {
  return {
    id: raw.mapbox_id,
    name: raw.name,
    context: raw.place_formatted || raw.full_address || raw.address || '',
    featureType: raw.feature_type,
    maki: raw.maki || null,
    raw,
  }
}

export interface DestinationSearch {
  /** Fired per keystroke by the caller, and billed once for all of them. */
  suggest(query: string, signal?: AbortSignal): Promise<Suggestion[]>
  /** The second call. It closes the billed session, so only a real pick may make it. */
  resolve(suggestion: Suggestion): Promise<Place>
}

/** `token` is a function so that tests can supply one, and so that it is read late. */
export function createDestinationSearch(
  language = preferredLanguage(),
  token: () => string = requireToken,
): DestinationSearch {
  let core: SearchBoxCore | null = null
  let sessionToken = new SessionToken()

  // Built on first use rather than here, because requireToken() throws while
  // the token is still the .env.example placeholder — and a throw during the
  // component's render is a blank screen where the search sheet should be.
  // Deferred, the same throw arrives as a rejected promise and reads as an
  // error row above the list.
  const open = () =>
    (core ??= new SearchBoxCore({
      accessToken: token(),
      language,
      limit: LIMIT,
      proximity: NO_PROXIMITY,
    }))

  return {
    async suggest(query, signal) {
      const { suggestions } = await open().suggest(query, { sessionToken, signal })
      const rows = suggestions ?? []
      return rows.filter((s) => !REFINEMENT_TYPES.has(s.feature_type)).map(toSuggestion)
    },

    async resolve(suggestion) {
      const { features } = await open().retrieve(suggestion.raw, { sessionToken })
      // The pick is what ends the session that every keystroke shared. Rotate
      // now so the next search is billed as a new one — and only once the call
      // has landed, so that retrying a failed retrieve stays inside the session
      // it belongs to rather than opening a second one.
      sessionToken = new SessionToken()

      const feature = features[0]
      if (!feature) {
        throw new MapboxError(`Für „${suggestion.name}“ liefert Mapbox keine Koordinaten.`)
      }
      const [lon, lat] = feature.geometry.coordinates
      // Name and context stay as the tapped row worded them. Only the
      // coordinates are new: the destination should read back as the thing
      // that was chosen, not as Mapbox's second description of it.
      return { id: suggestion.id, name: suggestion.name, context: suggestion.context, lat, lon }
    },
  }
}
