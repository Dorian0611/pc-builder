import { describe, expect, it } from 'vitest'
import {
  buildCodeFromHash,
  decodeBuild,
  encodeBuild,
  loadSavedBuilds,
  packId,
  shareUrl,
  unpackId,
  withSavedBuild,
} from './share'
import type { Part } from './types'

const A = '92f76877-d37d-4026-a930-e71d0880d506'
const B = '0edb1176-bee6-412a-b9ba-6ccc45fa0887'
const C = '1c16dbfa-0c47-425b-ad18-e06972ca6ffc'
const D = 'ffffffff-0000-4000-8000-00000000ffff'

const parts: Record<string, Part> = {
  [A]: { id: A, category: 'cpu' } as Part,
  [B]: { id: B, category: 'memory' } as Part,
  [C]: { id: C, category: 'memory' } as Part,
  [D]: { id: D, category: 'case' } as Part,
  'odd.id/1': { id: 'odd.id/1', category: 'gpu' } as Part,
}
const getPart = (id: string) => parts[id]

describe('part ids in links', () => {
  it('packs a UUID into 22 url-safe characters and back', () => {
    for (const id of [A, B, C, D]) {
      const t = packId(id)
      expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/)
      expect(unpackId(t)).toBe(id)
    }
  })
  it('keeps non-UUID ids readable and reversible', () => {
    expect(unpackId(packId('odd.id/1'))).toBe('odd.id/1')
    expect(packId('odd.id/1')).not.toContain('.')
  })
  it('rejects malformed tokens', () => {
    expect(unpackId('abc')).toBeUndefined()
    expect(unpackId('~%E0%A4%A')).toBeUndefined()
  })
})

describe('build codes', () => {
  it('round-trips a build, multi categories included', () => {
    const sel = { cpu: [A], memory: [B, C, B], case: [D], gpu: ['odd.id/1'] }
    const { selection, missing } = decodeBuild(encodeBuild(sel), getPart)
    expect(missing).toBe(0)
    expect(selection).toEqual(sel)
  })
  it('a full build stays short', () => {
    const code = encodeBuild({ cpu: [A], memory: [B, C], case: [D] })
    expect(code.length).toBeLessThanOrEqual(4 * 23)
  })
  it('skips parts that are no longer in the catalog and counts them', () => {
    const gone = packId('00000000-0000-4000-8000-000000000000')
    const { selection, missing } = decodeBuild(`${packId(A)}.${gone}.junk`, getPart)
    expect(selection).toEqual({ cpu: [A] })
    expect(missing).toBe(2)
  })
  it('reads the code from the hash and builds a share URL', () => {
    const url = shareUrl({ cpu: [A] }, 'https://example.org/pc-builder/?x=1#old')
    expect(url).toBe(`https://example.org/pc-builder/?x=1#b=${packId(A)}`)
    expect(buildCodeFromHash(new URL(url).hash)).toBe(packId(A))
    expect(buildCodeFromHash('')).toBeNull()
    expect(shareUrl({}, 'https://example.org/#b=x')).toBe('https://example.org/')
  })
})

describe('saved builds', () => {
  it('replaces a build with the same name and keeps newest first', () => {
    let list = withSavedBuild([], 'Gamer', { cpu: [A] })
    list = withSavedBuild(list, 'Iroda', { case: [D] })
    list = withSavedBuild(list, ' Gamer ', { cpu: [A], memory: [B] })
    expect(list.map((b) => b.name)).toEqual(['Gamer', 'Iroda'])
    expect(decodeBuild(list[0].code, getPart).selection).toEqual({ cpu: [A], memory: [B] })
  })
  it('ignores broken storage', () => {
    expect(loadSavedBuilds({ getItem: () => 'not json' })).toEqual([])
    expect(loadSavedBuilds({ getItem: () => '[{"name":1},{"name":"x","code":""}]' })).toHaveLength(1)
  })
})
