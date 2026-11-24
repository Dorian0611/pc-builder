import type { Part } from './types'

/** Words that only describe colour/packaging and make price-comparison searches worse. */
const NOISE = /\b(black|white|silver|fekete|feh[eé]r|retail|box|oem\/tray|tray|kit of \d+|desktop memory)\b/gi

/**
 * Search text for a part: brand + the first few words of the name.
 * OpenDB names are often long ("North ATX Mid Tower Black Tempered Glass…"),
 * and price comparison sites match better on a short query.
 */
export function searchQuery(p: Part): string {
  const words = p.name.replace(NOISE, ' ').replace(/[()]/g, ' ').split(/\s+/).filter(Boolean)
  return `${p.brand} ${words.slice(0, 6).join(' ')}`.trim()
}

/** Link to the Árukereső search results for this part (always current, no data copied). */
export const arukeresoSearchUrl = (p: Part) =>
  `https://www.arukereso.hu/CategorySearch.php?st=${encodeURIComponent(searchQuery(p)).replace(/%20/g, '+')}`
