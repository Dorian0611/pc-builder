import { describe, expect, it } from 'vitest'
import { buildIndex } from '../../scripts/prices/lib.mjs'
import { cpuModelIndex, matchCpuModel, matchMpnInName, nameHasBrand } from '../../scripts/prices/match.mjs'
import { cpuNameKey } from '../../scripts/perf.mjs'

const identifiers = {
  ventus: { mpn: ['RTX 5060 8G VENTUS 2X OC', 'G5060-8V2C'] },
  d3hp: { mpn: ['B650M D3HP'] },
  d3hpAx: { mpn: ['B650M D3HP AX'] },
  observatory: { mpn: ['OBSERVATORY HF GW'] },
  nr200: { mpn: ['Cooler Master', 'NR200PV2-KCNN-S00'] },
  storm: { mpn: ['AC1200'] },
  twinA: { mpn: ['SHARED-CODE-1'] },
  twinB: { mpn: ['SHARED-CODE-1'] },
}
const brands: Record<string, string> = {
  ventus: 'MSI', d3hp: 'Gigabyte', d3hpAx: 'Gigabyte', observatory: 'KOLINK', nr200: 'Cooler Master', storm: 'YEYIAN', twinA: 'X', twinB: 'X',
}
const index = buildIndex(identifiers)
const match = (name: string) => matchMpnInName(name, index, (id: string) => brands[id])

describe('part numbers inside shop names', () => {
  it('finds a multi-word part number in the middle of the name', () => {
    expect(match('MSI Videokártya PCI-Ex16x nVIDIA RTX 5060 VENTUS 2X 8GB DDR7 OC V1 RTX 5060 8G VENTUS 2X OC V1')).toBe('ventus')
  })
  it('the longest run wins: the AX board is not the plain one', () => {
    expect(match('GIGABYTE B650M D3HP AX alaplap')).toBe('d3hpAx')
    expect(match('GIGABYTE B650M D3HP alaplap')).toBe('d3hp')
  })
  it('wordy codes need 3+ words', () => {
    expect(match('Kolink Observatory HF üveg ablakos fehér számítógépház (OBSERVATORY HF GW)')).toBe('observatory')
  })
  it('the brand must be in the name, and a brand is not a part number', () => {
    expect(match('TP-LINK Wireless Mesh Networking system AC1200 HC220-G5')).toBeUndefined()
    expect(match('COOLER MASTER CPU hűtő Hyper 212 Black, Univerzális RR-S4KK-25SN-R1')).toBeUndefined()
  })
  it('accessories are skipped', () => {
    expect(match('Gigabyte B650M D3HP kiegészítő előlap')).toBeUndefined()
  })
  it('an ambiguous code is no match', () => {
    expect(match('X SHARED-CODE-1')).toBeUndefined()
  })
  it('brand aliases', () => {
    expect(nameHasBrand('WD Blue SN580 1TB', 'Western Digital')).toBe(true)
    expect(nameHasBrand('ID-Cooling SE-224-XTS', 'ID-COOLING')).toBe(true)
    expect(nameHasBrand('Kingston NV3', 'Samsung')).toBe(false)
  })
})

describe('CPUs by model', () => {
  const cpus = [
    { id: 'i3', brand: 'Intel', name: 'Core i3 13100' },
    { id: 'i3f', brand: 'Intel', name: 'Core i3 13100F' },
    { id: 'r5', brand: 'AMD', name: 'Ryzen 5 8600G' },
  ]
  const idx = cpuModelIndex(cpus, cpuNameKey)
  it('tray / OEM listings match the model', () => {
    expect(matchCpuModel('Intel Core i3-13100 3,4GHz 12MB LGA1700 OEM CM8071505092202', idx, cpuNameKey)).toBe('i3')
    expect(matchCpuModel('Intel Core i3 13100F 3.4GHz/4C/12M Without Graphics Tray', idx, cpuNameKey)).toBe('i3f')
    expect(matchCpuModel('AMD Ryzen 5 8600G 4,3GHz AM5 OEM 100-000001237', idx, cpuNameKey)).toBe('r5')
  })
  it('not a CPU: coolers, boards, complete computers', () => {
    expect(matchCpuModel('Hűtő Intel i3 13100-hoz', idx, cpuNameKey)).toBeUndefined()
    expect(matchCpuModel('Dell OptiPlex 7410 AIO 23,8FHD/i3-13100/16GB All-in-One asztali számítógép', idx, cpuNameKey)).toBeUndefined()
  })
})
