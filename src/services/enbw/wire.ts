/**
 * EnBW's undocumented public endpoint (the one behind their own web map), and
 * the only file that knows its field names.
 *
 * Only the Worker parses these records: it asks for one station at a time and
 * trims the response before answering the client. Station *identity* — name,
 * address, power, point count — still comes from the shipped list and never
 * from here.
 *
 * Two endpoints answer with this shape, and they are not equally rich. The
 * bounding-box query (offline list builder only) returns the station-level
 * fields; `/chargestations/{id}` additionally returns `chargePoints`,
 * `openingTimes` and the free-text notes. Everything below the occupancy counts
 * is therefore optional: it is present on a detail lookup and absent on a box
 * query.
 *
 * Two upstream blocks are deliberately not modelled at all. `pricingInfo` and
 * `authenticationMethods` are both tariff-dependent — what a charge costs and
 * how you unlock it follow the driver's own contract, which this app has no way
 * of knowing — so quoting either would be presenting someone else's plan as
 * fact.
 *
 * Verified against
 * api.emp.emob-enbw.com/emobility-public-api/api/v1/chargestations.
 */
export interface EnbwStation {
  /** True for cluster placeholders, which carry no per-station data. */
  grouped: boolean
  stationId: number
  lat: number
  lon: number
  shortAddress: string | null
  operator: string | null
  operatorCode: string | null
  priceGroup: string | null
  numberOfChargePoints: number | null
  availableChargePoints: number | null
  unknownStateChargePoints: number | null
  maxPowerInKw: number | null
  alwaysOpen: boolean | null

  /* Detail endpoint only, so all optional. */

  /** One entry per physical charge point, each with its own connectors. */
  chargePoints?: EnbwChargePoint[] | null
  /**
   * Free-text location, e.g. "ENI Schottwien" or a supermarket name, often with
   * access and parking prose on the lines below it.
   *
   * Read by the offline list builder and by nothing at runtime: its first line
   * is baked into the shipped list as each station's heading, so the app never
   * waits on a lookup to know what to call a row.
   */
  additionalInfo?: string | null
}

export interface EnbwChargePoint {
  /** The OCPI EVSE id, e.g. "AT*SMA*EAT0300026*001DC". Unique per point. */
  evseId: string | null
  /** Observed: AVAILABLE, OCCUPIED, OUT_OF_SERVICE. */
  status: string | null
  connectors?: EnbwConnector[] | null
}

export interface EnbwConnector {
  /** Machine name, e.g. "CCS". `plugTypeName` is the one to show a human. */
  chargePlugTypeGroup: string | null
  /** Display name, e.g. "CCS (Typ 2)", "Typ 2", "CHAdeMO". */
  plugTypeName: string | null
  maxPowerInKw: number | null
}

/**
 * EnBW's own tariff. This — not `operatorCode === 'DEEBW'` — is what identifies
 * the EnBW network: EnBW runs abroad as SMATRICS EnBW (`ITSMA`, `ATSMA`) and has
 * German subsidiaries (`DEODR`, `DESMA`), all billed at this price group. It is
 * the filter the offline list builder applies, so it is now implicit in the data
 * rather than checked at runtime.
 */
export const ENBW_PRICE_GROUP = 'ENBW_GROUP'

/** The id namespace, so a second provider could never collide. */
export const chargerId = (stationId: number): string => `enbw:${stationId}`

/**
 * The station id back out of a charger id.
 *
 * Reads the part after the namespace without re-checking it — every caller is
 * already holding an EnBW charger, and there is no second provider to confuse
 * it with.
 */
export const stationIdOf = (chargerId: string): number => Number(chargerId.split(':')[1])
