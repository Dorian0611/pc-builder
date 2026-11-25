// Relative gaming performance scores, used by the upgrade advisor (and later the FPS estimate).
//
// These are our own rough estimates, not benchmark results: the site shows them as
// "becsült" and only uses them to compare parts.
//   CPU: Ryzen 5 7600 = 100, computed from OpenDB data (architecture, boost clock, cores, cache).
//   GPU: GeForce RTX 4060 = 100, a hand-kept table per graphics chip (typical 1080p/1440p
//        raster performance). Workstation cards are left out: they are not bought for games.

/** Gaming performance per GHz relative to Zen 4 (game workloads, not Cinebench). */
export const CPU_ARCH_IPC = {
  Excavator: 0.45,
  Zen: 0.62,
  'Zen+': 0.66,
  'Zen 2': 0.75,
  'Zen 3': 0.88,
  'Zen 4': 1.0,
  'Zen 5': 1.05,
  Skylake: 0.7,
  'Kaby Lake': 0.7,
  'Coffee Lake': 0.71,
  'Coffee Lake Refresh': 0.72,
  'Comet Lake': 0.73,
  'Rocket Lake': 0.8,
  'Alder Lake': 0.92,
  'Raptor Lake': 0.97,
  'Raptor Lake Refresh': 0.97,
  'Arrow Lake': 0.95,
  'Arrow Lake Refresh': 0.96,
}

/** Games use up to ~8 fast cores; fewer cores or no SMT costs frames. */
function coreFactor(cores, threads) {
  if (cores >= 8) return 1.04
  if (cores >= 6) return threads > cores ? 1 : 0.92
  if (cores >= 4) return threads > cores ? 0.85 : 0.72
  return threads > cores ? 0.55 : 0.45
}

const round = (x) => Math.round(x)
const REFERENCE = 1.0 * 5.1 * 1.0 // Ryzen 5 7600: Zen 4, 5.1 GHz, 6 cores / 12 threads

/**
 * @param {object} j  OpenDB CPU record
 * @returns {number | undefined}
 */
export function cpuPerfScore(j) {
  let ipc = CPU_ARCH_IPC[j.microarchitecture]
  // hybrid AMD parts such as "2x Zen 4 , 4x Zen 4c"
  if (ipc === undefined && /Zen 4/.test(j.microarchitecture ?? '')) ipc = CPU_ARCH_IPC['Zen 4'] * 0.9
  // CPUs without turbo (Celeron, Pentium, some i3) list boost as 0
  const clock = j.clocks?.performance?.boost || j.clocks?.performance?.base
  if (!ipc || !(clock > 0)) return undefined
  // Intel hybrid: only the P-cores count; the E-cores add a little
  const p = j.cores?.performance || j.cores?.total
  const e = j.cores?.efficiency || 0
  const threads = j.cores?.threads ?? p
  const pThreads = e ? threads - e : threads
  let score = ipc * clock * coreFactor(p, pThreads) * (e ? 1.02 : 1)
  // 3D V-Cache (96 MB+ L3 on Zen 3/4/5 desktop parts) helps games a lot
  if (/^Zen [345]$/.test(j.microarchitecture) && (j.cache?.l3 ?? 0) >= 96) score *= 1.2
  return round((score / REFERENCE) * 100)
}

/** Relative gaming performance per chip (GeForce RTX 4060 = 100). */
export const GPU_PERF = {
  // NVIDIA – Fermi … Maxwell
  'GeForce GTS 450': 8, 'GeForce GTX 460': 13, 'GeForce GTX 480': 18, 'GeForce GTX 550 Ti': 10,
  'GeForce GTX 560': 14, 'GeForce GTX 560 SE': 12, 'GeForce GTX 560 Ti': 16, 'GeForce GTX 570': 19,
  'GeForce GTX 580': 22, 'GeForce GTX 590': 30, 'GeForce GTX 580 X2': 30,
  'GeForce GT 710': 4, 'GeForce GT 730': 6, 'GeForce GT 740': 8, 'GeForce GT 1030': 13,
  'GeForce GTX 650': 12, 'GeForce GTX 650 Ti': 18, 'GeForce GTX 650 Ti Boost': 22, 'GeForce GTX 660': 25,
  'GeForce GTX 660 Ti': 29, 'GeForce GTX 670': 32, 'GeForce GTX 680': 35, 'GeForce GTX 690': 50,
  'GeForce GTX 750': 18, 'GeForce GTX 750 Ti': 21, 'GeForce GTX 760': 30, 'GeForce GTX 770': 37,
  'GeForce GTX 780': 44, 'GeForce GTX 780 Ti': 52, 'GeForce GTX Titan': 46, 'GeForce GTX Titan Black': 52,
  'GeForce GTX Titan Z': 70, 'GeForce GTX 950': 28, 'GeForce GTX 960': 33, 'GeForce GTX 970': 45,
  'GeForce GTX 980': 53, 'GeForce GTX 980 Ti': 65, 'GeForce GTX Titan X': 66,
  // Pascal, Turing
  'GeForce GTX 1050': 22, 'GeForce GTX 1050 Ti': 28, 'GeForce GTX 1060': 50, 'GeForce GTX 1070': 64,
  'GeForce GTX 1070 Ti': 71, 'GeForce GTX 1080': 79, 'GeForce GTX 1080 Ti': 98, 'Titan X (Pascal)': 95,
  'Titan Xp': 102, 'GeForce GTX 1630': 20, 'GeForce GTX 1650': 38, 'GeForce GTX 1650 SUPER': 48,
  'GeForce GTX 1660': 54, 'GeForce GTX 1660 SUPER': 60, 'GeForce GTX 1660 Ti': 60,
  'GeForce RTX 2060': 70, 'GeForce RTX 2060 SUPER': 80, 'GeForce RTX 2070': 85, 'GeForce RTX 2070 SUPER': 95,
  'GeForce RTX 2080': 103, 'GeForce RTX 2080 SUPER': 108, 'GeForce RTX 2080 Ti': 125, 'Titan RTX': 130,
  // Ampere
  'GeForce RTX 3050 6 GB': 50, 'GeForce RTX 3050 8 GB': 62, 'GeForce RTX 3060 8 GB': 78,
  'GeForce RTX 3060 12 GB': 85, 'GeForce RTX 3060 Ti': 108, 'GeForce RTX 3060 Ti GDDR6X': 110,
  'GeForce RTX 3070': 120, 'GeForce RTX 3070 LHR': 120, 'GeForce RTX 3070 Ti': 128,
  'GeForce RTX 3080 10 GB': 155, 'GeForce RTX 3080 12 GB': 162, 'GeForce RTX 3080 Ti': 170,
  'GeForce RTX 3090': 175, 'GeForce RTX 3090 Ti': 190,
  // Ada, Blackwell
  'GeForce RTX 4060': 100, 'GeForce RTX 4060 Ti 8 GB': 120, 'GeForce RTX 4060 Ti': 121, 'GeForce RTX 4070': 150,
  'GeForce RTX 4070 SUPER': 172, 'GeForce RTX 4070 Ti': 185, 'GeForce RTX 4070 Ti SUPER': 200,
  'GeForce RTX 4080': 225, 'GeForce RTX 4080 SUPER': 230, 'GeForce RTX 4090': 290,
  'GeForce RTX 5050': 92, 'GeForce RTX 5060': 120, 'GeForce RTX 5060 Ti': 140, 'GeForce RTX 5060 Ti 16 GB': 142,
  'GeForce RTX 5070': 175, 'GeForce RTX 5070 Ti': 220, 'GeForce RTX 5080': 250, 'GeForce RTX 5090': 340,
  // AMD – GCN
  'Radeon HD 6970': 20, 'Radeon HD 7750': 12, 'Radeon HD 7770': 15, 'Radeon HD 7770 GHz Edition': 15,
  'Radeon HD 7850': 22, 'Radeon HD 7870': 26, 'Radeon HD 7870 GHz Edition': 26, 'Radeon HD 7950': 31,
  'Radeon HD 7970': 35, 'Radeon R7 240': 6, 'Radeon R7 350': 10, 'Radeon R7 360': 15, 'Radeon R7 370': 22,
  'Radeon R9 270': 25, 'Radeon R9 270X': 27, 'Radeon R9 280': 31, 'Radeon R9 280X': 35, 'Radeon R9 290': 43,
  'Radeon R9 290X': 46, 'Radeon R9 295X2': 70, 'Radeon R9 380': 33, 'Radeon R9 380X': 37, 'Radeon R9 390': 46,
  'Radeon R9 390X': 49, 'Radeon R9 390X2': 70, 'Radeon R9 Fury': 54, 'Radeon R9 Nano': 52,
  'Radeon RX 460': 22, 'Radeon RX 470': 40, 'Radeon RX 480': 46, 'Radeon RX 550': 12, 'Radeon RX 560': 22,
  'Radeon RX 570': 43, 'Radeon RX 580': 48, 'Radeon RX 590': 52, 'Radeon RX Vega 56': 62,
  'Radeon RX Vega 64': 68, 'Radeon VII': 85,
  // RDNA
  'Radeon RX 5500 XT': 50, 'Radeon RX 5600 XT': 72, 'Radeon RX 5700': 80, 'Radeon RX 5700 XT': 88,
  'Radeon RX 6400': 33, 'Radeon RX 6500 XT': 37, 'Radeon RX 6600': 88, 'Radeon RX 6600 XT': 98,
  'Radeon RX 6650 XT': 102, 'Radeon RX 6700': 112, 'Radeon RX 6700 XT': 125, 'Radeon RX 6750 XT': 130,
  'Radeon RX 6800': 155, 'Radeon RX 6800 XT': 175, 'Radeon RX 6900 XT': 185, 'Radeon RX 6950 XT': 195,
  'Radeon RX 7600': 105, 'Radeon RX 7600 XT': 110, 'Radeon RX 7700 XT': 145, 'Radeon RX 7800 XT': 170,
  'Radeon RX 7900 GRE': 185, 'Radeon RX 7900 XT': 215, 'Radeon RX 7900 XTX': 245,
  'Radeon RX 9060': 112, 'Radeon RX 9060 XT 8 GB': 128, 'Radeon RX 9060 XT 16 GB': 132,
  'Radeon RX 9070 GRE': 165, 'Radeon RX 9070': 200, 'Radeon RX 9070 XT': 225,
  // Intel
  'Arc A310': 25, 'Arc A380': 33, 'Arc A580': 82, 'Arc A750': 92, 'Arc A770': 100, 'Arc B570': 105, 'Arc B580': 118,
}

/** @param {string | undefined} chip */
export const gpuPerfScore = (chip) => (chip ? GPU_PERF[chip] : undefined)
