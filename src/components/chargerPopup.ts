import type { ChargerOnRoute } from '../core/types'
import { formatDetour, formatDistance, formatPower } from './format'

/**
 * The card shown when a charger dot on the map is tapped.
 *
 * Markup rather than a React tree because Mapbox popups live outside React's
 * root and take a string. That makes escaping this module's whole job: every
 * value here comes from a provider response, and a station named with a stray
 * angle bracket must not be able to put markup into the page.
 */
export function chargerPopupHtml(item: ChargerOnRoute): string {
  const { charger } = item
  const free = charger.availablePoints
  // `null` means the provider has no live data at all, which is a different
  // statement from "zero free" — never render the two the same way.
  const availability = free == null ? '? free' : `${free}/${charger.totalPoints} free`

  return [
    '<div class="space-y-1 text-slate-100">',
    `<div class="font-semibold">${escapeHtml(charger.name)}</div>`,
    charger.address ? `<div class="text-slate-400">${escapeHtml(charger.address)}</div>` : '',
    `<div class="text-slate-300">${escapeHtml(formatPower(charger.maxPowerKw))} · ${escapeHtml(availability)}</div>`,
    `<div class="text-slate-400">${escapeHtml(formatDistance(item.alongDistanceM))} along · detour ${escapeHtml(formatDetour(item.detourS))}</div>`,
    '</div>',
  ].join('')
}

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ENTITIES[c])
