// ────────────────────────────────────────────────────────
// Terrenos (folha "[LPC] Terrains" v7). Cada terreno é um bloco de
// 3×7 tiles de 32px; os blocos ficam numa grade de 10 colunas, com
// faixas de 224px de altura. `block` = [faixa, coluna].
//
// `rank` decide quem é desenhado por cima quando dois terrenos se
// encontram (maior = por cima). Precisa ser único.
// ────────────────────────────────────────────────────────

export interface TerrainDef {
  id: string
  label: string
  category: string
  block: [band: number, col: number]
  rank: number
  /** Não dá pra andar por cima (água, lava, buraco). */
  solid?: boolean
  /** Quadros de variação do miolo que existem na folha (padrão 15, 16, 17). */
  fills?: number[]
}

export const TERRAIN_TEXTURE = 'terrain'
export const TERRAIN_URL = 'lpc/terrain.png'

export const TERRAINS: TerrainDef[] = [
  // Gramas (no fundo de tudo)
  { id: 'grass',        label: 'Grama',            category: 'Grama',   block: [1, 0], rank: 10 },
  { id: 'grass-light',  label: 'Grama clara',      category: 'Grama',   block: [1, 1], rank: 11 },
  { id: 'grass-dark',   label: 'Grama escura',     category: 'Grama',   block: [1, 2], rank: 12 },
  { id: 'grass-dry',    label: 'Grama seca',       category: 'Grama',   block: [1, 3], rank: 13 },
  { id: 'dirt-weeds',   label: 'Terra com mato',   category: 'Terra',   block: [0, 9], rank: 20 },
  { id: 'dirt-soft',    label: 'Terra fofa',       category: 'Terra',   block: [1, 9], rank: 21, fills: [15, 16] },
  // Terras e caminhos
  { id: 'dirt',         label: 'Terra',            category: 'Terra',   block: [0, 1], rank: 30 },
  { id: 'dirt-light',   label: 'Terra clara',      category: 'Terra',   block: [0, 0], rank: 31 },
  { id: 'dirt-red',     label: 'Terra vermelha',   category: 'Terra',   block: [0, 2], rank: 32 },
  { id: 'sand',         label: 'Areia',            category: 'Areia e neve', block: [1, 5], rank: 40 },
  { id: 'sand-rocky',   label: 'Areia pedregosa',  category: 'Areia e neve', block: [3, 5], rank: 41 },
  { id: 'snow',         label: 'Neve',             category: 'Areia e neve', block: [1, 6], rank: 42 },
  { id: 'snow-gray',    label: 'Neve suja',        category: 'Areia e neve', block: [1, 7], rank: 43 },
  { id: 'gravel-light', label: 'Cascalho claro',   category: 'Pedra',   block: [0, 3], rank: 50 },
  { id: 'gravel',       label: 'Cascalho',         category: 'Pedra',   block: [0, 4], rank: 51 },
  { id: 'gravel-dark',  label: 'Cascalho escuro',  category: 'Pedra',   block: [0, 5], rank: 52 },
  { id: 'gravel-black', label: 'Cascalho negro',   category: 'Pedra',   block: [0, 6], rank: 53 },
  { id: 'pebbles',      label: 'Pedrinhas',        category: 'Pedra',   block: [1, 8], rank: 54, fills: [15, 16] },
  { id: 'cobble-light', label: 'Calçamento claro', category: 'Pedra',   block: [3, 6], rank: 60 },
  { id: 'cobble-sand',  label: 'Calçamento de terra', category: 'Pedra', block: [3, 7], rank: 61 },
  { id: 'stone-moss',   label: 'Pedra com musgo',  category: 'Pedra',   block: [3, 8], rank: 62 },
  { id: 'stone-brown',  label: 'Pedra marrom com musgo', category: 'Pedra', block: [3, 9], rank: 63 },
  // Líquidos (com margem de terra desenhada na borda)
  { id: 'swamp',        label: 'Pântano',          category: 'Água',    block: [2, 4], rank: 70 },
  { id: 'water-light',  label: 'Água rasa',        category: 'Água',    block: [2, 0], rank: 71, solid: true },
  { id: 'water',        label: 'Água',             category: 'Água',    block: [2, 1], rank: 72, solid: true },
  { id: 'water-deep',   label: 'Água funda',       category: 'Água',    block: [2, 2], rank: 73, solid: true },
  { id: 'water-poison', label: 'Água venenosa',    category: 'Água',    block: [2, 3], rank: 74, solid: true },
  { id: 'lava',         label: 'Lava',             category: 'Água',    block: [2, 5], rank: 75, solid: true },
  // Buracos
  { id: 'hole',         label: 'Buraco',           category: 'Buracos', block: [0, 7], rank: 80, solid: true, fills: [] },
  { id: 'pit',          label: 'Abismo',           category: 'Buracos', block: [0, 8], rank: 81, solid: true, fills: [] },
]

export const terrainById = new Map(TERRAINS.map((t) => [t.id, t]))

/** Nome do quadro `n` (0..20) do terreno na textura. */
export function terrainFrame(id: string, n: number) {
  return `${id}:${n}`
}

/** Posição do quadro `n` do bloco na folha. */
export function terrainFrameRect(t: TerrainDef, n: number) {
  const [band, col] = t.block
  return { x: col * 96 + (n % 3) * 32, y: band * 224 + Math.floor(n / 3) * 32 }
}
