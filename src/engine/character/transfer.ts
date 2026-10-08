// ────────────────────────────────────────────────────────
// Exportar e importar personagens (tokens) como arquivo .json:
//   { "format": "vortable-character", "version": 1, "characters": [{ "name", "appearance" }] }
// O arquivo não leva id (quem importa ganha um id novo) e vale entre campanhas,
// entre o Vortable solto e o Vorterium. Peças que o catálogo não conhece são descartadas.
// ────────────────────────────────────────────────────────

import type { CharacterSave } from '../types'
import { newCharacter, parseCharacter } from './storage'
import { normalizeAppearance, type CharacterData } from './catalog'

export const CHARACTER_FORMAT = 'vortable-character'

/** O arquivo com um ou mais personagens, pronto pra gravar. */
export function exportCharacters(list: Pick<CharacterSave, 'name' | 'appearance'>[]): string {
  return JSON.stringify(
    { format: CHARACTER_FORMAT, version: 1, characters: list.map((c) => ({ name: c.name, appearance: c.appearance })) },
    null,
    2,
  )
}

/** Nome de arquivo seguro: "Maria da Silva" → "maria-da-silva.vortable-personagem.json". */
export function characterFileName(name: string) {
  const slug = name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${slug || 'personagem'}.vortable-personagem.json`
}

/**
 * Lê o conteúdo de um arquivo de personagem (texto JSON ou já convertido).
 * Devolve os personagens com ids novos; lança um erro em português se não for um arquivo válido.
 */
export function parseCharacterFile(raw: unknown, data?: CharacterData): CharacterSave[] {
  let json = raw
  if (typeof raw === 'string') {
    try { json = JSON.parse(raw) } catch { throw new Error('O arquivo não é um JSON válido.') }
  }
  const file = json as { format?: unknown; characters?: unknown; appearance?: unknown; name?: unknown } | null
  if (!file || typeof file !== 'object') throw new Error('Este arquivo não é um personagem do Vortable.')
  // aceita o arquivo completo ou um personagem solto ({ name, appearance })
  const entries: unknown[] = file.format === CHARACTER_FORMAT && Array.isArray(file.characters)
    ? file.characters
    : file.appearance ? [file] : []
  const out: CharacterSave[] = []
  for (const entry of entries) {
    const e = entry as { name?: unknown; appearance?: unknown }
    const parsed = parseCharacter({ id: 'x', name: e?.name, appearance: e?.appearance })
    if (!parsed) continue
    const name = (typeof e.name === 'string' && e.name.trim() ? e.name.trim() : 'Sem nome').slice(0, 80)
    out.push(newCharacter(name, data ? normalizeAppearance(data, parsed.appearance) : parsed.appearance))
  }
  if (!out.length) throw new Error('Este arquivo não é um personagem do Vortable.')
  return out
}

/** Baixa um texto como arquivo (navegador). */
export function downloadText(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Abre o seletor de arquivo e devolve o texto do escolhido (null se cancelar). */
export function pickTextFile(accept = '.json,application/json'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = async () => {
      const file = input.files?.[0]
      resolve(file ? await file.text() : null)
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}
