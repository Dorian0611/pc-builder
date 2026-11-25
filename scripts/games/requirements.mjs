// Reading games' Steam system requirements into our performance scores.
//
// A game's "recommended" specs are taken as what it needs for ~60 FPS at 1080p on
// medium–high settings. Text is free-form ("GTX 1060 6GB / RX 580 8GB", "Ryzen 5 CPU or
// Equivalent", "Quad-core 3.0 GHz"), so this is best effort and every value is an estimate.

import { cpuNameKey, GPU_PERF } from '../perf.mjs'

/**
 * Lower median: requirement lines list alternatives ("i7-12700 or Ryzen 7 7800X3D"), any of
 * which is enough, so with two values the weaker one counts.
 */
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[(s.length - 1) >> 1] : undefined
}

/** Steam's HTML requirement block → plain text. */
export const plainText = (html) =>
  String(html ?? '')
    .replace(/<br\s*\/?>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&amp;/g, ' ')
    .replace(/[™®©]/g, '')
    .replace(/[ \t]+/g, ' ')

/** The text after "Processor:" / "Graphics:" up to the next "Label:". */
export function section(text, label) {
  const next = 'OS|Processor|CPU|Memory|Graphics|Video Card|GPU|DirectX|Network|Storage|Hard Drive|Sound Card|Additional Notes|VR Support'
  const m = text.match(new RegExp(`\\b${label}\\s*:\\s*([\\s\\S]*?)(?=\\n|\\b(?:${next})\\s*:|$)`, 'i'))
  return m ? m[1].trim() : ''
}

// ---------------------------------------------------------------- GPU

const gpuKeys = Object.keys(GPU_PERF)

/** One GPU mention → score, via the chip table (variants such as "3060 12 GB" included). */
function gpuScore(name) {
  const exact = GPU_PERF[name]
  if (exact !== undefined) return exact
  const variants = gpuKeys.filter((k) => k.startsWith(name + ' ') && !/Ti|SUPER|XT|GRE/.test(k.slice(name.length)))
  return median(variants.map((k) => GPU_PERF[k]))
}

/** All recognised GPUs in a requirement text, with their scores. */
export function parseGpus(text) {
  const found = []
  const add = (name) => {
    const s = gpuScore(name)
    if (s !== undefined && !found.some((f) => f.name === name)) found.push({ name, score: s })
  }
  // "GeForce 1060" without GTX
  for (const m of text.matchAll(/geforce\s*(\d{3,4})\s*(Ti)?\b/gi)) {
    const n = Number(m[1])
    if (n >= 600 && n < 1700) add(`GeForce GTX ${m[1]}${m[2] ? ' Ti' : ''}`)
  }
  const t = text.replace(/nvidia|geforce|amd|radeon|intel/gi, ' ').replace(/\s+/g, ' ')
  for (const m of t.matchAll(/\b(RTX|GTX|GT)\s*-?\s*(\d{3,4})\s*(Ti|SUPER|Super)?(?:\s*(Ti|SUPER|Super))?/g)) {
    const suffix = [m[3], m[4]].filter(Boolean).map((x) => (/super/i.test(x) ? 'SUPER' : 'Ti')).join(' ')
    add(`GeForce ${m[1]} ${m[2]}${suffix ? ' ' + suffix : ''}`)
  }
  for (const m of t.matchAll(/\bRX\s*-?\s*(\d{3,4})\s*(XTX|XT|GRE)?/gi)) add(`Radeon RX ${m[1]}${m[2] ? ' ' + m[2].toUpperCase() : ''}`)
  for (const m of t.matchAll(/\bRX\s*Vega\s*(56|64)/gi)) add(`Radeon RX Vega ${m[1]}`)
  for (const m of t.matchAll(/\bR([79])\s*(\d{3}X?)\b/g)) add(`Radeon R${m[1]} ${m[2]}`)
  for (const m of t.matchAll(/\bHD\s*(\d{4})\b/g)) add(`Radeon HD ${m[1]}`)
  for (const m of t.matchAll(/\bArc\s*([AB]\d{3})\b/gi)) add(`Arc ${m[1].toUpperCase()}`)
  return found
}

/** "4 GB VRAM" when no model is named – a rough floor. */
function vramGuess(text) {
  const m = text.match(/(\d{1,2})\s*GB/i)
  if (!m) return undefined
  const gb = Number(m[1])
  return gb >= 12 ? 120 : gb >= 8 ? 80 : gb >= 6 ? 60 : gb >= 4 ? 40 : 20
}

// ---------------------------------------------------------------- CPU

/** Same tier and generation, for models OpenDB doesn't have (i5-2500K → median of "i5 2…"). */
function familyPrefix(key) {
  let m
  if ((m = key.match(/^(i[3579]) (\d+)/))) return `${m[1]} ${m[2].length === 5 ? m[2].slice(0, 2) : m[2][0]}`
  if ((m = key.match(/^(ryzen [3579]|ultra [3579]|fx) (\d)/))) return `${m[1]} ${m[2]}`
  return undefined
}

export function cpuScoreFromKey(key, scores) {
  if (scores[key] !== undefined) return scores[key]
  const prefix = familyPrefix(key)
  if (!prefix) return undefined
  return median(Object.entries(scores).filter(([k]) => familyPrefix(k) === prefix).map(([, v]) => v))
}

/** Generic phrases when no model is named ("Ryzen 5 CPU", "Intel Core i7", "Quad-core 3 GHz"). */
function genericCpu(text) {
  const t = text.toLowerCase()
  if (/ryzen 7|core i7/.test(t)) return 55
  if (/ryzen 5|core i5/.test(t)) return 45
  if (/ryzen 3|core i3/.test(t)) return 35
  const cores = t.match(/(dual|quad|hexa|six|octa|eight)[- ]core/)
  if (cores) return { dual: 20, quad: 30, hexa: 40, six: 40, octa: 50, eight: 50 }[cores[1]]
  return undefined
}

/** Recognised CPUs in a requirement text, with their scores. */
export function parseCpus(text, scores) {
  const found = []
  // split on alternatives so "i5-8400 / Ryzen 5 2600" yields both
  for (const part of text.split(/\/|\bor\b|,|\|/i)) {
    const key = cpuNameKey(part)
    if (!key) continue
    const s = cpuScoreFromKey(key, scores)
    if (s !== undefined && !found.some((f) => f.key === key)) found.push({ key, score: s })
  }
  return found
}

// ---------------------------------------------------------------- game

/** Minimum specs aim lower (≈30 FPS, low settings): scale them up to a "recommended" level. */
export const MIN_TO_RECOMMENDED = 1.6

/**
 * @param {{ minimum?: string, recommended?: string }} pcRequirements  Steam's HTML blocks
 * @param {Record<string, number>} cpuScores  data/cpu-scores.json
 * @returns {{ cpu?: number, gpu?: number, cpuText?: string, gpuText?: string, basis: 'recommended' | 'minimum' } | null}
 */
export function demandFromRequirements(pcRequirements, cpuScores) {
  for (const basis of /** @type {const} */ (['recommended', 'minimum'])) {
    const text = plainText(pcRequirements?.[basis])
    if (!text.trim()) continue
    const cpuText = section(text, 'Processor') || section(text, 'CPU')
    const gpuText = section(text, 'Graphics') || section(text, 'Video Card') || section(text, 'GPU')
    const gpus = parseGpus(gpuText)
    const cpus = parseCpus(cpuText, cpuScores)
    const gpu = median(gpus.map((g) => g.score)) ?? vramGuess(gpuText)
    const cpu = median(cpus.map((c) => c.score)) ?? genericCpu(cpuText)
    if (gpu === undefined) continue
    const k = basis === 'minimum' ? MIN_TO_RECOMMENDED : 1
    return {
      gpu: Math.round(gpu * k),
      cpu: cpu === undefined ? undefined : Math.round(cpu * k),
      cpuText: cpuText.slice(0, 120) || undefined,
      gpuText: gpuText.slice(0, 120) || undefined,
      basis,
    }
  }
  return null
}
