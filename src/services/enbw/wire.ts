/**
 * EnBW's undocumented public endpoint (the one behind their own web map), and
 * the only file that knows its field names.
 *
 * Only the Worker parses these records now: it asks for one station at a time
 * and trims the response to the occupancy counts before answering the client.
 * Everything else about a station comes from the shipped list.
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
  authenticationMethods: string[] | null
  alwaysOpen: boolean | null
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
