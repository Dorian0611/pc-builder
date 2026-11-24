import cpu from './fixtures/cpu.json'
import motherboard from './fixtures/motherboard.json'
import memory from './fixtures/memory.json'
import gpu from './fixtures/gpu.json'
import storage from './fixtures/storage.json'
import psu from './fixtures/psu.json'
import pcCase from './fixtures/case.json'
import cooler from './fixtures/cooler.json'
import { createCatalog } from '../lib/catalog'
import type { CatalogData } from '../lib/types'

/** Kis, kézzel írt alkatrészlista a szabályok teszteléséhez. */
export const fixtureCatalog = createCatalog({
  cpu, motherboard, memory, gpu, storage, psu, case: pcCase, cooler,
} as unknown as CatalogData)
