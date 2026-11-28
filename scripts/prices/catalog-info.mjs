// What the price sources need from our own catalogue (public/data) to match shop names:
// each part's brand, and CPU models.

import fs from 'node:fs'
import path from 'node:path'
import { cpuNameKey } from '../perf.mjs'
import { cpuModelIndex } from './match.mjs'

const CATEGORIES = ['cpu', 'motherboard', 'memory', 'gpu', 'storage', 'psu', 'case', 'cooler']

export function loadCatalogInfo(root = path.resolve(import.meta.dirname, '../..')) {
  const brands = new Map()
  let cpus = []
  for (const c of CATEGORIES) {
    const list = JSON.parse(fs.readFileSync(path.join(root, 'public/data', `${c}.json`), 'utf8'))
    for (const p of list) brands.set(p.id, p.brand)
    if (c === 'cpu') cpus = list
  }
  return {
    brandOf: (id) => brands.get(id),
    cpuIndex: cpuModelIndex(cpus, cpuNameKey),
    cpuKeyOf: cpuNameKey,
  }
}
