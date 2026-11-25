// Currency conversion for foreign shop prices: ECB daily reference rates + VAT adjustment.
//
// A foreign gross price is turned into "what it would cost with Hungarian VAT":
//   net  = gross / (1 + VAT of the shop's country)
//   HUF  = net × (HUF per unit of the currency) × (1 + 27%)
// Market differences (distribution, shipping, margins) are handled later by calibrating
// against Hungarian shop prices (see foreign.mjs), not here.

import { get } from './http.mjs'

export const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

/** Standard VAT rates (2026) of the countries whose shops we may read. */
export const VAT = { HU: 0.27, DE: 0.19, AT: 0.2, PL: 0.23, CZ: 0.21, SK: 0.23, NL: 0.21, GB: 0.2, FR: 0.2, IT: 0.22, ES: 0.21, CH: 0.081, SE: 0.25, DK: 0.25, NO: 0.25 }

/** Parses the ECB XML: rates per 1 EUR, plus EUR itself and the reference date. */
export function parseEcbXml(xml) {
  const rates = { EUR: 1 }
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates[m[1]] = Number(m[2])
  const date = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1]
  if (!rates.HUF) throw new Error('ECB rates without HUF')
  return { date, rates }
}

export async function fetchEcbRates() {
  const res = await get(ECB_URL, { accept: 'application/xml' })
  if (!res.body) throw new Error(`ECB rates: HTTP ${res.status} ${res.error ?? ''}`)
  return parseEcbXml(res.body)
}

/** HUF for one unit of `currency`. */
export function hufPer(currency, rates) {
  const perEur = rates[currency]
  if (!perEur) throw new Error(`no ECB rate for ${currency}`)
  return rates.HUF / perEur
}

/** Foreign gross price → comparable Hungarian gross price (before market calibration). */
export function toHungarianGross(grossPrice, currency, country, rates) {
  const vat = VAT[country]
  if (vat === undefined) throw new Error(`no VAT rate for ${country}`)
  return Math.round((grossPrice / (1 + vat)) * hufPer(currency, rates) * (1 + VAT.HU))
}
