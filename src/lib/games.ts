// Per-game FPS estimate from the CPU/GPU scores and a game's demand (public/data/games.json,
// built by scripts/games/update-games.mjs from Steam's most played list).
//
// A game's demand is the score its recommended specs need for ~60 FPS at 1080p on
// medium–high settings. FPS scales with GPU power (less at higher resolutions) until the
// CPU can't prepare frames faster. Rough by nature: shown as "kb." and rounded.

import { limiterOf, type PerfModel } from './upgrade'

export interface Game {
  id: string
  name: string
  /** CPU / GPU score needed for ~60 FPS at 1080p (CPU may be unknown) */
  cpu?: number
  gpu: number
  /** demand set by hand (no usable official specs, e.g. not out on PC yet) */
  estimated?: boolean
  note?: string
  cpuText?: string
  gpuText?: string
  rank?: number
  steamAppId?: number
}

export interface GameList {
  updatedAt: string
  source: string
  games: Game[]
}

export type Resolution = '1080p' | '1440p' | '4k'

/** GPU-bound FPS relative to 1080p. */
export const RESOLUTIONS: Record<Resolution, { label: string; factor: number }> = {
  '1080p': { label: '1080p (Full HD)', factor: 1 },
  '1440p': { label: '1440p (QHD)', factor: 0.68 },
  '4k': { label: '4K (UHD)', factor: 0.4 },
}

const BASE_FPS = 60

/** What each part alone would allow in this game. */
export function fpsParts(game: Game, res: Resolution, cpu: number | undefined, gpu: number) {
  return {
    gpuFps: (BASE_FPS * gpu * RESOLUTIONS[res].factor) / game.gpu,
    cpuFps: cpu !== undefined && game.cpu ? (BASE_FPS * cpu) / game.cpu : Infinity,
  }
}

export function estimateFps(game: Game, res: Resolution, cpu: number | undefined, gpu: number | undefined): number | undefined {
  if (gpu === undefined) return undefined
  const { gpuFps, cpuFps } = fpsParts(game, res, cpu, gpu)
  return Math.min(gpuFps, cpuFps)
}

export function gameModel(game: Game, res: Resolution): PerfModel {
  return {
    score: (cpu, gpu) => estimateFps(game, res, cpu, gpu),
    limiter: (cpu, gpu) => {
      const { gpuFps, cpuFps } = fpsParts(game, res, cpu, gpu)
      return limiterOf(cpuFps, gpuFps)
    },
  }
}

/** Display: rounded to 5, very high values capped – beyond that the estimate means little. */
export function formatFps(fps: number | undefined): string {
  if (fps === undefined) return '–'
  if (fps >= 240) return '240+'
  return String(Math.max(5, Math.round(fps / 5) * 5))
}

export async function loadGames(baseUrl = `${import.meta.env.BASE_URL}data/`): Promise<GameList | null> {
  try {
    const res = await fetch(`${baseUrl}games.json`)
    return res.ok ? ((await res.json()) as GameList) : null
  } catch {
    return null
  }
}
