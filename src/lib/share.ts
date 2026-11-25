// Builds in links (#b=…) and builds saved in the browser.
//
// A link holds only part ids: each OpenDB UUID is packed into 22 base64url characters, and
// the category comes from the catalog when the link is opened, so a full build fits in ~200
// characters. No server is involved: the link itself is the saved build.

import { CATEGORIES, withPart } from './catalog'
import type { BuildSelection, Part } from './types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SEP = '.'

/** Part id → link token: a UUID in 22 base64url characters, anything else as "~" + escaped id. */
export function packId(id: string): string {
  if (!UUID.test(id)) return '~' + encodeURIComponent(id).replace(/\./g, '%2E')
  const hex = id.replace(/-/g, '')
  let bin = ''
  for (let i = 0; i < 32; i += 2) bin += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Link token → part id; undefined when the token is malformed. */
export function unpackId(token: string): string | undefined {
  if (token.startsWith('~')) {
    try {
      return decodeURIComponent(token.slice(1)) || undefined
    } catch {
      return undefined
    }
  }
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return undefined
  const bin = atob(token.replace(/-/g, '+').replace(/_/g, '/') + '==')
  const hex = [...bin].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Selection → the value of the "b" hash parameter ("" for an empty build). */
export function encodeBuild(sel: BuildSelection): string {
  return CATEGORIES.flatMap((c) => sel[c.id] ?? []).map(packId).join(SEP)
}

/**
 * Hash parameter → selection. Parts that are no longer in the catalog are skipped and
 * counted, so the page can say the link was only partly restored.
 */
export function decodeBuild(code: string, getPart: (id: string) => Part | undefined): { selection: BuildSelection; missing: number } {
  let selection: BuildSelection = {}
  let missing = 0
  for (const token of code.split(SEP)) {
    if (!token) continue
    const id = unpackId(token)
    const part = id ? getPart(id) : undefined
    if (part) selection = withPart(selection, part)
    else missing++
  }
  return { selection, missing }
}

/** The "b" parameter of a location hash such as "#b=…", or null when there is none. */
export function buildCodeFromHash(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get('b')
}

/** Shareable link of a build, based on the current page address. */
export function shareUrl(sel: BuildSelection, href: string): string {
  const url = new URL(href)
  const code = encodeBuild(sel)
  url.hash = code ? `b=${code}` : ''
  return url.toString()
}

// ---- builds saved in this browser ----

export interface SavedBuild {
  name: string
  savedAt: string
  /** encodeBuild() of the selection */
  code: string
}

const SAVED_KEY = 'pc-builder:saved'

export function loadSavedBuilds(storage: Pick<Storage, 'getItem'> = localStorage): SavedBuild[] {
  try {
    const list = JSON.parse(storage.getItem(SAVED_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((b) => b && typeof b.name === 'string' && typeof b.code === 'string') : []
  } catch {
    return []
  }
}

export function storeSavedBuilds(list: SavedBuild[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(SAVED_KEY, JSON.stringify(list))
}

/** Adds a build, or replaces the one with the same name (newest first). */
export function withSavedBuild(list: SavedBuild[], name: string, sel: BuildSelection, now = new Date()): SavedBuild[] {
  const entry: SavedBuild = { name: name.trim(), savedAt: now.toISOString(), code: encodeBuild(sel) }
  return [entry, ...list.filter((b) => b.name !== entry.name)]
}
