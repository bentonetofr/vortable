// Preferências de quem usa o editor (favoritos, recentes), guardadas só
// neste navegador. O storage pode estar bloqueado: aí só não lembra.

export function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

export function writeList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    /* sem storage: não lembra */
  }
}
