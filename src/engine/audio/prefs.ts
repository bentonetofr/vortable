// Preferências de som de quem está jogando (não da zona): volume, mudo,
// passos e se o editor toca os sons. Ficam no navegador.

export interface SoundPrefs {
  master: number
  muted: boolean
  steps: number
  /** O editor toca o som da zona (prévia). */
  editor: boolean
}

const KEY = 'vortable:sound'
const DEFAULTS: SoundPrefs = { master: 0.8, muted: false, steps: 0.7, editor: false }
let cached: SoundPrefs | null = null

export function readPrefs(): SoundPrefs {
  if (cached) return cached
  try {
    cached = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    cached = { ...DEFAULTS }
  }
  return cached!
}

export function writePrefs(patch: Partial<SoundPrefs>) {
  cached = { ...readPrefs(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(cached))
  } catch {
    // sem armazenamento: vale só nesta aba
  }
  return cached
}
