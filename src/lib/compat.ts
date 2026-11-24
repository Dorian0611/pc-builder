import type { CheckLevel, CheckResult, Part, ResolvedBuild } from './types'

/** Tápegység tartalék a becsült csúcsfogyasztás felett. */
export const PSU_HEADROOM = 1.3

/** Ha nincs fogyasztási adat, ezzel számolunk (óvatos, felfelé kerekített érték). */
const FALLBACK_CPU_W = 150
const FALLBACK_GPU_W = 250

export interface PowerEstimate {
  /** becsült csúcsfogyasztás (W) */
  peakW: number
  /** javasolt minimális tápteljesítmény, 50 W-ra kerekítve */
  recommendedW: number
  /** volt olyan alkatrész, amelynek nem ismert a fogyasztása */
  uncertain: boolean
}

export function estimatePower(b: ResolvedBuild): PowerEstimate {
  let w = 50 // alaplap, ventilátorok, USB alapterhelés
  let uncertain = false
  if (b.cpu) {
    const cpuW = b.cpu.peakW ?? (b.cpu.tdpW ? Math.round(b.cpu.tdpW * 1.35) : undefined)
    if (cpuW === undefined) uncertain = true
    w += cpuW ?? FALLBACK_CPU_W
  }
  if (b.gpu) {
    if (b.gpu.tdpW === undefined) uncertain = true
    w += b.gpu.tdpW ?? FALLBACK_GPU_W
  }
  for (const m of b.memory) w += 5 * m.modules
  for (const s of b.storage) w += s.kind === 'HDD' ? 8 : s.interface === 'SATA' ? 4 : 7
  if (b.cooler) w += b.cooler.type === 'aio' ? 15 : 5
  return { peakW: w, recommendedW: Math.ceil((w * PSU_HEADROOM) / 50) * 50, uncertain }
}

const ids = (...parts: (Part | undefined)[]) =>
  parts.filter((p): p is Part => !!p).map((p) => p.id)

const missing = (...vals: unknown[]) =>
  vals.some((v) => v === undefined || v === null || (Array.isArray(v) && v.length === 0))

/**
 * Lefuttatja a kompatibilitási szabályokat. Csak azok a szabályok futnak,
 * amelyekhez minden érintett alkatrész ki van választva.
 * Hiányzó adat esetén "unknown" (nem ellenőrizhető) — sosem zöld.
 */
export function checkBuild(b: ResolvedBuild): CheckResult[] {
  const out: CheckResult[] = []
  const add = (rule: string, level: CheckLevel, message: string, partIds: string[]) =>
    out.push({ rule, level, message, partIds })

  const { cpu, motherboard: mb, gpu, psu, cooler } = b
  const pcCase = b.case

  // 1. CPU foglalat
  if (cpu && mb) {
    const p = ids(cpu, mb)
    if (missing(cpu.socket, mb.socket)) add('cpu-socket', 'unknown', 'A CPU vagy az alaplap foglalata nem ismert.', p)
    else if (cpu.socket !== mb.socket)
      add('cpu-socket', 'error', `A processzor ${cpu.socket} foglalatú, az alaplap ${mb.socket}.`, p)
    else add('cpu-socket', 'ok', `Foglalat egyezik (${cpu.socket}).`, p)
  }

  // 2. Memória típus (RAM ↔ alaplap, CPU ↔ alaplap)
  if (mb) {
    for (const m of b.memory) {
      const p = ids(m, mb)
      if (missing(m.memoryType, mb.memoryType)) add('memory-type', 'unknown', 'A memória típusa nem ismert.', p)
      else if (m.memoryType !== mb.memoryType)
        add('memory-type', 'error', `${m.memoryType} memória nem fér az alaplap ${mb.memoryType} foglalataiba.`, p)
      else add('memory-type', 'ok', `Memória típus egyezik (${m.memoryType}).`, p)
    }
    if (cpu && cpu.socket === mb.socket && cpu.memoryTypes?.length && !cpu.memoryTypes.includes(mb.memoryType))
      add('memory-type', 'error', `A processzor nem támogatja a(z) ${mb.memoryType} memóriát.`, ids(cpu, mb))
  }

  // 3. Memória mennyiség
  if (mb && b.memory.length > 0) {
    const p = ids(mb, ...b.memory)
    const modules = b.memory.reduce((s, m) => s + m.modules, 0)
    const totalGb = b.memory.reduce((s, m) => s + m.modules * m.moduleSizeGb, 0)
    if (mb.memorySlots === undefined)
      add('memory-capacity', 'unknown', 'Az alaplap memóriahelyeinek száma nem ismert.', p)
    else if (modules > mb.memorySlots)
      add('memory-capacity', 'error', `${modules} modul, de az alaplapon csak ${mb.memorySlots} memóriahely van.`, p)
    else if (mb.maxMemoryGb !== undefined && totalGb > mb.maxMemoryGb)
      add('memory-capacity', 'error', `${totalGb} GB memória, az alaplap legfeljebb ${mb.maxMemoryGb} GB-ot kezel.`, p)
    else if (mb.maxMemoryGb === undefined)
      add('memory-capacity', 'unknown', `${modules} modul belefér, de az alaplap maximális memóriája nem ismert.`, p)
    else add('memory-capacity', 'ok', `${modules} modul, ${totalGb} GB – belefér (${mb.memorySlots} hely).`, p)
  }
  if (b.memory.length > 1)
    add('memory-mix', 'warning', 'Több memóriakészlet keverése instabil lehet; egy nagyobb kit biztosabb.', ids(...b.memory))

  // 4. Alaplap méret ↔ ház
  if (mb && pcCase) {
    const p = ids(mb, pcCase)
    if (missing(mb.formFactor, pcCase.supportedBoards)) add('board-size', 'unknown', 'Az alaplap vagy a ház mérete nem ismert.', p)
    else if (!pcCase.supportedBoards.includes(mb.formFactor))
      add('board-size', 'error', `${mb.formFactor} alaplap nem fér a házba (${pcCase.supportedBoards.join(', ')}).`, p)
    else add('board-size', 'ok', `${mb.formFactor} alaplap befér a házba.`, p)
  }

  // 5. Videókártya hossza
  if (gpu && pcCase) {
    const p = ids(gpu, pcCase)
    if (gpu.lengthMm === undefined || pcCase.maxGpuLengthMm === undefined)
      add('gpu-length', 'unknown', 'A videókártya hossza vagy a ház korlátja nem ismert.', p)
    else if (gpu.lengthMm > pcCase.maxGpuLengthMm)
      add('gpu-length', 'error', `A videókártya ${gpu.lengthMm} mm, a ház legfeljebb ${pcCase.maxGpuLengthMm} mm-t enged.`, p)
    else add('gpu-length', 'ok', `Videókártya befér (${gpu.lengthMm} / ${pcCase.maxGpuLengthMm} mm).`, p)
  }

  // 6. Hűtő magassága / radiátor
  if (cooler && pcCase) {
    const p = ids(cooler, pcCase)
    if (cooler.type === 'air') {
      if (cooler.heightMm === undefined || pcCase.maxCoolerHeightMm === undefined)
        add('cooler-fit', 'unknown', 'A hűtő magassága vagy a ház hűtőkorlátja nem ismert – nézd meg a ház adatlapján.', p)
      else if (cooler.heightMm > pcCase.maxCoolerHeightMm)
        add('cooler-fit', 'error', `A hűtő ${cooler.heightMm} mm magas, a házba legfeljebb ${pcCase.maxCoolerHeightMm} mm fér.`, p)
      else add('cooler-fit', 'ok', `Hűtő befér (${cooler.heightMm} / ${pcCase.maxCoolerHeightMm} mm).`, p)
    } else {
      if (cooler.radiatorMm === undefined || !pcCase.radiatorSizesMm?.length)
        add('cooler-fit', 'unknown', `A ház radiátortámogatása nincs az adatbázisban – ellenőrizd, hogy ${cooler.radiatorMm ?? '?'} mm-es radiátor szerelhető-e.`, p)
      else if (!pcCase.radiatorSizesMm.includes(cooler.radiatorMm))
        add('cooler-fit', 'error', `${cooler.radiatorMm} mm-es radiátor nem szerelhető a házba.`, p)
      else add('cooler-fit', 'ok', `${cooler.radiatorMm} mm-es radiátor szerelhető.`, p)
    }
  }

  // 7. Hűtő foglalat
  if (cooler && cpu) {
    const p = ids(cooler, cpu)
    if (missing(cooler.sockets, cpu.socket)) add('cooler-socket', 'unknown', 'A hűtő támogatott foglalatai nem ismertek.', p)
    else if (!cooler.sockets.includes(cpu.socket))
      add('cooler-socket', 'error', `A hűtő nem támogatja a(z) ${cpu.socket} foglalatot.`, p)
    else add('cooler-socket', 'ok', `Hűtő illik a(z) ${cpu.socket} foglalathoz.`, p)
  }

  // 8. Táp teljesítmény
  if (psu && (cpu || gpu)) {
    const p = ids(psu, cpu, gpu)
    const est = estimatePower(b)
    const note = est.uncertain ? ' (egy alkatrész fogyasztása nem ismert, óvatos becslés)' : ''
    if (psu.wattage < est.peakW)
      add('psu-wattage', 'error', `A táp (${psu.wattage} W) kevesebb, mint a becsült csúcsfogyasztás (${est.peakW} W)${note}.`, p)
    else if (psu.wattage < est.peakW * PSU_HEADROOM)
      add('psu-wattage', 'warning', `Kevés a tartalék: becsült csúcs ${est.peakW} W, javasolt legalább ${est.recommendedW} W${note}.`, p)
    else add('psu-wattage', 'ok', `${psu.wattage} W elég (becsült csúcs ${est.peakW} W)${note}.`, p)
  }

  // 9. Tápcsatlakozók
  if (psu && gpu) {
    const p = ids(psu, gpu)
    if (!gpu.powerConnectors || !psu.connectors) {
      add('psu-connectors', 'unknown', 'A videókártya vagy a táp csatlakozói nem ismertek.', p)
    } else {
      const need = gpu.powerConnectors
      const have = psu.connectors
      const problems: string[] = []
      if ((need['12V-2x6'] ?? 0) > (have['12V-2x6'] ?? 0))
        problems.push('a kártya 12V-2x6 csatlakozót kér, a tápon nincs – adapterrel működhet, de natív kábel ajánlott')
      if ((need['8pin'] ?? 0) > (have['8pin'] ?? 0))
        problems.push(`a kártya ${need['8pin']} db 8 tűs csatlakozót kér, a tápon ${have['8pin'] ?? 0} van`)
      if (problems.length) add('psu-connectors', 'warning', `Tápcsatlakozó: ${problems.join('; ')}.`, p)
      else add('psu-connectors', 'ok', 'A táp csatlakozói elegendők a videókártyához.', p)
    }
  }

  // 10. M.2 / SATA helyek
  if (mb && b.storage.length > 0) {
    const p = ids(mb, ...b.storage)
    const m2 = b.storage.filter((s) => s.interface.startsWith('M.2')).length
    const sata = b.storage.filter((s) => s.interface === 'SATA').length
    const issues: string[] = []
    let unknown = false
    if (m2 > 0) {
      if (mb.m2Slots === undefined) unknown = true
      else if (m2 > mb.m2Slots) issues.push(`${m2} M.2 meghajtó, de az alaplapon ${mb.m2Slots} M.2 hely van`)
    }
    if (sata > 0) {
      if (mb.sataPorts === undefined) unknown = true
      else if (sata > mb.sataPorts) issues.push(`${sata} SATA meghajtó, de az alaplapon ${mb.sataPorts} SATA port van`)
    }
    if (issues.length) add('storage-slots', 'warning', `${issues.join('; ')}.`, p)
    else if (unknown) add('storage-slots', 'unknown', 'Az alaplap M.2/SATA csatlakozóinak száma nem ismert.', p)
    else add('storage-slots', 'ok', 'Elég M.2/SATA csatlakozó van a meghajtókhoz.', p)
  }

  // 11. BIOS frissítés
  if (cpu && mb && cpu.socket === mb.socket && mb.chipset && cpu.biosUpdateChipsets?.includes(mb.chipset))
    add('bios', 'warning', `${mb.chipset} lapkakészletű alaplapon a(z) ${cpu.name} processzorhoz BIOS-frissítés kellhet (ellenőrizd a gyártói CPU-támogatási listát).`, ids(cpu, mb))

  // 12. Integrált grafika
  if (cpu && !gpu) {
    if (cpu.integratedGraphics === undefined) add('igpu', 'unknown', 'Nem ismert, hogy a CPU-nak van-e integrált grafikája.', ids(cpu))
    else if (!cpu.integratedGraphics)
      add('igpu', 'error', 'Nincs videókártya, és a processzornak nincs integrált grafikája – nem lesz kép.', ids(cpu))
    else add('igpu', 'ok', 'Videókártya nélkül az integrált grafika ad képet.', ids(cpu))
  }

  // 13. Táp méret ↔ ház
  if (psu && pcCase) {
    const p = ids(psu, pcCase)
    if (!pcCase.psuFormFactors?.length) add('psu-size', 'unknown', 'A ház által támogatott tápméret nem ismert.', p)
    else if (!pcCase.psuFormFactors.includes(psu.formFactor))
      add('psu-size', 'error', `${psu.formFactor} táp nem szerelhető a házba (${pcCase.psuFormFactors.join(', ')}).`, p)
    else
      add('psu-size', 'ok', pcCase.psuFormFactorsInferred
        ? `${psu.formFactor} táp valószínűleg szerelhető (ATX ház, adatlap szerint nem ellenőrzött).`
        : `${psu.formFactor} táp szerelhető a házba.`, p)
  }

  return out
}

const ORDER: Record<CheckLevel, number> = { error: 0, warning: 1, unknown: 2, ok: 3 }

export function sortChecks(r: CheckResult[]): CheckResult[] {
  return [...r].sort((a, b) => ORDER[a.level] - ORDER[b.level])
}

export function worstLevel(r: CheckResult[]): CheckLevel {
  return r.reduce<CheckLevel>((w, c) => (ORDER[c.level] < ORDER[w] ? c.level : w), 'ok')
}
