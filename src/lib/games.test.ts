import { describe, expect, it } from 'vitest'
import { cpuNameKey } from '../../scripts/perf.mjs'
import { cpuScoreFromKey, demandFromRequirements, MIN_TO_RECOMMENDED, parseCpus, parseGpus, section } from '../../scripts/games/requirements.mjs'
import { fixtureCatalog } from '../test/fixtureCatalog'
import { estimateFps, formatFps, gameModel, type Game } from './games'
import { adviseUpgrades } from './upgrade'

const scores = { 'i5 4460': 30, 'i5 4590': 32, 'i5 2400': 26, 'i5 2600k': 29, 'ryzen 5 3600': 62, 'i7 12700': 90, 'ryzen 7 7800x3d': 122, 'fx 8350': 26 }

describe('CPU names in requirements', () => {
  it('normalises how games write CPU models', () => {
    expect(cpuNameKey('Intel® Core™ i5-4460')).toBe('i5 4460')
    expect(cpuNameKey('AMD Ryzen 5 3600X')).toBe('ryzen 5 3600x')
    expect(cpuNameKey('AMD FX-8350')).toBe('fx 8350')
    expect(cpuNameKey('Intel Core Ultra 7 265K')).toBe('ultra 7 265k')
    expect(cpuNameKey('Quad-core 3.0 GHz')).toBeUndefined()
  })
  it('unknown models fall back to the median of the same tier and generation', () => {
    expect(cpuScoreFromKey('i5 2500k', scores)).toBe(26)
    expect(cpuScoreFromKey('i9 9900k', scores)).toBeUndefined()
  })
  it('alternatives: either is enough, so the weaker one counts', () => {
    const found = parseCpus('Intel Core i7-12700 or AMD Ryzen 7 7800X3D', scores)
    expect(found.map((f) => f.score)).toEqual([90, 122])
    const d = demandFromRequirements({ recommended: '<strong>Processor:</strong> Intel Core i7-12700 or AMD Ryzen 7 7800X3D<br><strong>Graphics:</strong> RTX 2060 SUPER or RX 5700 XT' }, scores)
    expect(d?.cpu).toBe(90)
    expect(d?.gpu).toBe(80)
  })
})

describe('GPU names in requirements', () => {
  it('reads NVIDIA, AMD and Intel models, with and without the series prefix', () => {
    expect(parseGpus('NVIDIA GeForce GTX 1060 6GB / AMD Radeon RX 580 8GB').map((g) => g.name)).toEqual(['GeForce GTX 1060', 'Radeon RX 580'])
    expect(parseGpus('Nvidia GeForce 1060 and higher').map((g) => g.name)).toEqual(['GeForce GTX 1060'])
    expect(parseGpus('RTX 4070 Ti SUPER, Radeon RX 7900 XT, Intel Arc B580').map((g) => g.name)).toEqual([
      'GeForce RTX 4070 Ti SUPER',
      'Radeon RX 7900 XT',
      'Arc B580',
    ])
    // a chip listed by memory variant in the table
    expect(parseGpus('GeForce RTX 3060').length).toBe(1)
  })
  it('a section ends at the next label only, not at any colon', () => {
    const t = 'Graphics: DirectX 11 level video card or higher and drivers: Nvidia GeForce 1060\nDirectX: Version 12'
    expect(section(t, 'Graphics')).toContain('GeForce 1060')
  })
  it('minimum specs are scaled up; no readable GPU → null', () => {
    const d = demandFromRequirements({ minimum: 'Processor: i5-4460\nGraphics: GTX 1060' }, scores)
    expect(d?.basis).toBe('minimum')
    expect(d?.gpu).toBe(Math.round(50 * MIN_TO_RECOMMENDED))
    expect(demandFromRequirements({ minimum: 'Graphics: DirectX 11 compatible' }, scores)).toBeNull()
  })
})

describe('FPS estimate', () => {
  const game: Game = { id: 'g', name: 'Test', cpu: 60, gpu: 100 }
  it('the recommended specs give 60 FPS at 1080p', () => {
    expect(estimateFps(game, '1080p', 60, 100)).toBe(60)
  })
  it('GPU-bound: scales with the GPU and drops at higher resolutions', () => {
    expect(estimateFps(game, '1080p', 200, 200)).toBe(120)
    expect(estimateFps(game, '4k', 200, 200)!).toBeLessThan(60)
  })
  it('CPU-bound: a faster GPU does not help past the CPU limit', () => {
    expect(estimateFps(game, '1080p', 60, 300)).toBe(60)
    expect(gameModel(game, '1080p').limiter(60, 300)).toBe('cpu')
  })
  it('is displayed rounded and capped', () => {
    expect(formatFps(61.7)).toBe('60')
    expect(formatFps(500)).toBe('240+')
    expect(formatFps(undefined)).toBe('–')
  })
  it('the advisor works with a game model: before/after FPS per suggestion', () => {
    const sel = { cpu: ['cpu-r5-7600'], motherboard: ['mb-msi-b650-gaming-plus'], gpu: ['gpu-asrock-7600-cl'], psu: ['psu-msi-a1000gl'] }
    const heavy: Game = { id: 'h', name: 'Heavy', cpu: 70, gpu: 130 }
    const a = adviseUpgrades(fixtureCatalog, sel, undefined, gameModel(heavy, '1440p'))
    expect(a.balance.gaming!).toBeLessThan(60)
    expect(a.gpu.length).toBeGreaterThan(0)
    for (const s of a.gpu) expect(s.score).toBeGreaterThan(a.balance.gaming!)
  })
})
