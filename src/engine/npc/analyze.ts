// ────────────────────────────────────────────────────────
// Análise da zona pro gerador de NPCs: olha o nome, os terrenos, os objetos e
// o tipo de ambiente e diz que "estilo" de gente combina com o lugar (uma
// biblioteca tem eruditos e guardas; uma fazenda, peões e fazendeiros...).
// ────────────────────────────────────────────────────────

import { objectDef } from '../assets/objects'
import { terrainById } from '../assets/terrains'
import type { ZoneData } from '../types'

export type ProfileId =
  | 'biblioteca' | 'taverna' | 'vila' | 'mercado' | 'fazenda' | 'floresta' | 'cemiterio' | 'masmorra' | 'neve' | 'geral'

export const PROFILE_LABELS: Record<ProfileId, string> = {
  biblioteca: 'Biblioteca / palácio',
  taverna: 'Taverna',
  vila: 'Vila',
  mercado: 'Mercado',
  fazenda: 'Fazenda',
  floresta: 'Floresta / campo',
  cemiterio: 'Cemitério',
  masmorra: 'Masmorra / caverna',
  neve: 'Terras geladas',
  geral: 'Lugar comum',
}

export interface ZoneAnalysis {
  profile: ProfileId
  label: string
  /** Por que esse estilo (pra mostrar ao mestre, curto). */
  reasons: string[]
  scores: Record<ProfileId, number>
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Palavras do nome da zona que já resolvem o estilo (peso alto). */
const NAME_HINTS: [ProfileId, RegExp][] = [
  ['biblioteca', /bibliotec|palaci|castelo|torre|arquivo|salao|trono|nobre|templo|igreja|catedral|academia|universidade|estudo/],
  ['taverna', /taverna|estalagem|bar\b|pousada|hospedaria|cantina|salao de festas/],
  ['mercado', /mercado|feira|bazar|loja|praca|comercio|porto/],
  ['fazenda', /fazenda|sitio|celeiro|plantacao|pasto|curral|moinho|horta/],
  ['floresta', /floresta|bosque|mata|selva|campo|trilha|clareira|lago|rio|pantano/],
  ['cemiterio', /cemiterio|tumulo|cripta|mausoleu|necropole|jazigo/],
  ['masmorra', /masmorra|calabouco|caverna|gruta|prisao|cela|esgoto|mina|subterraneo/],
  ['neve', /neve|gelo|geleira|tundra|montanha|nevasca|glacial/],
  ['vila', /vila|aldeia|povoado|cidade|vilarejo|rua|casa|ferraria|padaria/],
]

/** O que cada tipo de objeto (rótulo, categoria e etiquetas) "vota". */
const OBJECT_HINTS: [ProfileId, RegExp, number][] = [
  ['biblioteca', /estante|livro|pergaminho|biblioteca|globo|candelabro|estatua|vitral|lareira|tapete|trono|relogio de pendulo|organ/, 1.2],
  ['taverna', /barril|caneca|cerveja|taverna|balcao|tonel|jarra|prato|garrafa|banqueta|fogao/, 1.1],
  ['mercado', /barraca|feira|caixote|cesta|fruta|banca|toldo|balanca|saco|mercado|comida/, 0.8],
  ['fazenda', /plantac|trigo|milho|feno|celeiro|enxada|arado|espantalho|cerca|pa de|fazenda|cenoura|abobora|vaca|galinha/, 1],
  ['floresta', /arvore|arbusto|cogumelo|tronco|folha|samambaia|flor|planta|pedra|musgo|galho|acampamento|fogueira/, 0.35],
  ['cemiterio', /cemiterio|lapide|tumulo|cruz|caixao|cripta|jazigo|esqueleto|caveira|vela/, 1.4],
  ['masmorra', /masmorra|grade|cela|corrente|algema|tocha de parede|caveira|ossos|aranha|teia|cano/, 1.2],
  ['neve', /neve|gelo|boneco de neve|iglu|pinheiro/, 0.8],
  ['vila', /casa|poco|vila|placa|lampiao|ferraria|moinho|cerca/, 0.5],
]

export function analyzeZone(zone: ZoneData): ZoneAnalysis {
  const scores: Record<ProfileId, number> = {
    biblioteca: 0, taverna: 0, vila: 0, mercado: 0, fazenda: 0, floresta: 0, cemiterio: 0, masmorra: 0, neve: 0, geral: 0.4,
  }
  const why = new Map<ProfileId, Set<string>>()
  const add = (p: ProfileId, n: number, reason?: string) => {
    scores[p] += n
    if (reason) (why.get(p) ?? why.set(p, new Set()).get(p)!).add(reason)
  }

  // nome da zona
  const name = norm(zone.name)
  for (const [p, re] of NAME_HINTS) if (re.test(name)) add(p, 6, 'o nome da zona')

  // ambiente
  const place = zone.lighting?.place ?? 'outdoor'
  const indoors = place === 'indoor' || (zone.rooms?.some((r) => r) ?? false)
  if (place === 'underground') add('masmorra', 4, 'ambiente subterrâneo')

  // terrenos (cada vértice conta; o fundo vale pelos vértices vazios)
  const counts = new Map<string, number>()
  for (const c of zone.corners) counts.set(c || zone.base, (counts.get(c || zone.base) ?? 0) + 1)
  const total = zone.corners.length || 1
  let grass = 0, snow = 0, water = 0, stone = 0, plowed = 0
  for (const [id, n] of counts) {
    const t = terrainById.get(id)
    const cat = norm(`${t?.category ?? ''} ${t?.label ?? ''} ${id}`)
    if (/grama|grass/.test(cat)) grass += n
    if (/neve|snow/.test(cat)) snow += n
    if (/agua|water|pantano|swamp/.test(cat)) water += n
    if (/pedra|cascalho|gravel|cobble|calcamento/.test(cat)) stone += n
    if (/fazenda|arada|trigo/.test(cat)) plowed += n
  }
  if (snow / total > 0.25) add('neve', 5, 'neve no chão')
  if (grass / total > 0.4 && !indoors) { add('floresta', 1.5, 'muita grama'); add('vila', 0.5); add('fazenda', 0.5) }
  if (water / total > 0.2) add('floresta', 1)
  if (stone / total > 0.3 && !indoors) { add('vila', 1.2, 'ruas de pedra'); add('mercado', 0.6) }
  if (plowed / total > 0.03) add('fazenda', 4, 'terra arada e plantações')
  if (indoors) { add('biblioteca', 0.8); add('taverna', 0.8); add('vila', 0.3) }

  // objetos
  const hits: Record<ProfileId, number> = { biblioteca: 0, taverna: 0, vila: 0, mercado: 0, fazenda: 0, floresta: 0, cemiterio: 0, masmorra: 0, neve: 0, geral: 0 }
  for (const o of zone.objects) {
    const def = objectDef(o.kind)
    if (!def) continue
    const text = norm(`${def.label} ${def.category} ${def.tags.join(' ')}`)
    for (const [p, re, w] of OBJECT_HINTS) if (re.test(text)) hits[p] += w
  }
  const reasonFor: Record<ProfileId, string> = {
    biblioteca: 'estantes, livros e mobília fina', taverna: 'barris, mesas e canecas', vila: 'casas e ruas', mercado: 'barracas e mercadorias',
    fazenda: 'plantações e ferramentas do campo', floresta: 'árvores, plantas e pedras', cemiterio: 'lápides e tumbas', masmorra: 'grades, ossos e correntes',
    neve: 'neve e gelo', geral: '',
  }
  for (const p of Object.keys(hits) as ProfileId[]) {
    // retorno decrescente: 400 estantes não valem 40× mais que 10
    const v = Math.min(8, Math.sqrt(hits[p]) * 1.1)
    if (v >= 1) add(p, v, reasonFor[p])
  }

  let best: ProfileId = 'geral'
  for (const p of Object.keys(scores) as ProfileId[]) if (scores[p] > scores[best]) best = p
  return { profile: best, label: PROFILE_LABELS[best], reasons: [...(why.get(best) ?? [])].slice(0, 3), scores }
}
