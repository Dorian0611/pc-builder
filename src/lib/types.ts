// Alkatrész-adatmodell. A mezők neve angol (OpenDB-hez és kódhoz illeszkedik),
// a felületen megjelenő szövegek magyarok.
//
// Ami az OpenDB-ben hiányozhat, az opcionális: a kompatibilitás-ellenőrzés ilyenkor
// "nem ellenőrizhető" eredményt ad, sosem zöldet.

export type Category =
  | 'cpu'
  | 'motherboard'
  | 'memory'
  | 'gpu'
  | 'storage'
  | 'psu'
  | 'case'
  | 'cooler'

export type MemoryType = 'DDR4' | 'DDR5'
export type BoardFormFactor = 'E-ATX' | 'ATX' | 'mATX' | 'ITX'
export type PsuFormFactor = 'ATX' | 'SFX' | 'SFX-L'
export type StorageInterface = 'M.2 NVMe' | 'M.2 SATA' | 'SATA' | 'PCIe'

/** GPU tápcsatlakozók / táp kimenetek darabszáma */
export interface PowerConnectors {
  '12V-2x6'?: number
  '8pin'?: number
}

export interface PriceBlock {
  medianHuf: number
  minHuf: number
  offerCount: number
  /** ISO dátum */
  updatedAt: string
  links?: { arukereso?: string; argep?: string }
}

interface BasePart {
  /** OpenDB azonosító (UUID) */
  id: string
  category: Category
  brand: string
  name: string
  partNumber?: string
  releaseYear?: number
  price?: PriceBlock
}

export interface Cpu extends BasePart {
  category: 'cpu'
  socket: string
  cores?: number
  threads?: number
  /** névleges TDP / PBP */
  tdpW?: number
  /** tartós csúcsfogyasztás (PPT / MTP), ha ismert */
  peakW?: number
  integratedGraphics?: boolean
  memoryTypes?: MemoryType[]
  microarchitecture?: string
  /** Ezeken a lapkakészleteken a CPU-hoz BIOS-frissítés kellhet */
  biosUpdateChipsets?: string[]
  /** relatív játékteljesítmény (Ryzen 5 7600 = 100) */
  perfScore?: number
}

export interface Motherboard extends BasePart {
  category: 'motherboard'
  socket: string
  chipset?: string
  formFactor: BoardFormFactor
  memoryType: MemoryType
  memorySlots?: number
  maxMemoryGb?: number
  m2Slots?: number
  sataPorts?: number
}

export interface Memory extends BasePart {
  category: 'memory'
  memoryType: MemoryType
  modules: number
  moduleSizeGb: number
  speedMts?: number
  casLatency?: number
}

export interface Gpu extends BasePart {
  category: 'gpu'
  chip?: string
  vramGb?: number
  lengthMm?: number
  tdpW?: number
  powerConnectors?: PowerConnectors
  /** relatív játékteljesítmény (RTX 4060 = 100) */
  perfScore?: number
}

export interface Storage extends BasePart {
  category: 'storage'
  interface: StorageInterface
  capacityGb: number
  kind: 'SSD' | 'HDD'
  formFactor?: string
}

export interface Psu extends BasePart {
  category: 'psu'
  wattage: number
  formFactor: PsuFormFactor
  connectors?: PowerConnectors
  efficiency?: string
  modular?: string
  lengthMm?: number
}

export interface Case extends BasePart {
  category: 'case'
  caseType?: string
  supportedBoards: BoardFormFactor[]
  maxGpuLengthMm?: number
  maxCoolerHeightMm?: number
  maxPsuLengthMm?: number
  /** támogatott radiátorméretek (mm) – az OpenDB-ben nincs ilyen adat */
  radiatorSizesMm?: number[]
  psuFormFactors?: PsuFormFactor[]
  /** a tápméretet az alaplapméretből feltételeztük, nem az adatbázisból jön */
  psuFormFactorsInferred?: boolean
}

export interface Cooler extends BasePart {
  category: 'cooler'
  type: 'air' | 'aio'
  sockets: string[]
  heightMm?: number
  radiatorMm?: number
  fanSizeMm?: number
}

export type Part = Cpu | Motherboard | Memory | Gpu | Storage | Psu | Case | Cooler

export interface PartByCategory {
  cpu: Cpu
  motherboard: Motherboard
  memory: Memory
  gpu: Gpu
  storage: Storage
  psu: Psu
  case: Case
  cooler: Cooler
}

export type CatalogData = { [C in Category]: PartByCategory[C][] }

export interface CatalogMeta {
  source: string
  sourceUrl: string
  license: string
  licenseUrl: string
  commit: string
  importedAt: string
  counts: Partial<Record<Category, number>>
}

/** Egy összeállítás: kategóriánként a kiválasztott alkatrészek azonosítói. */
export type BuildSelection = Partial<Record<Category, string[]>>

/** Feloldott összeállítás: azonosítók helyett alkatrészek. */
export interface ResolvedBuild {
  cpu?: Cpu
  motherboard?: Motherboard
  memory: Memory[]
  gpu?: Gpu
  storage: Storage[]
  psu?: Psu
  case?: Case
  cooler?: Cooler
}

export type CheckLevel = 'error' | 'warning' | 'unknown' | 'ok'

export interface CheckResult {
  rule: string
  level: CheckLevel
  message: string
  /** az érintett alkatrészek azonosítói */
  partIds: string[]
}
