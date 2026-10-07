// ────────────────────────────────────────────────────────
// Terrenos. A maioria vem da folha "[LPC] Terrains" v7: cada terreno é
// um bloco de 3×7 tiles de 32px; os blocos ficam numa grade de 10
// colunas, com faixas de 224px de altura. `block` = [faixa, coluna].
// Os de interior (`gen`) são montados no navegador a partir de uma
// textura de 32×32 (genTerrain.ts) e ficam numa textura à parte.
//
// Os terrenos dos PACOTES (paredes, pisos, tapetes, fazenda) chegam
// depois, de catalog/terrains.json (scripts/build-catalog.mjs), e entram
// com addTerrains(): blocos LPC numa folha própria (`origin`), pisos
// gerados (`gen` com url) ou tabelas de autotile do Tiled (`wang`).
//
// `rank` decide quem é desenhado por cima quando dois terrenos se
// encontram (maior = por cima). Precisa ser único.
//
// Camadas: `ground` (chão, um terreno por vértice) e `overlay` (por cima
// do chão, numa grade própria: molduras de teto, tapetes).
// ────────────────────────────────────────────────────────

export interface TerrainDef {
  id: string
  label: string
  category: string
  block: [band: number, col: number]  // (terrenos de pacote: ignorado, exceto os gerados)
  rank: number
  /** Não dá pra andar por cima (água, lava, buraco, parede). */
  solid?: boolean
  /**
   * Bloqueia também em volta de cada vértice que encosta em outro terreno
   * (o vazio dos interiores: sem isso, a parede fina entre dois cômodos —
   * uma linha de vértices vazios — seria só desenho).
   */
  edgeSolid?: boolean
  /** Pode ser o fundo da zona (padrão: só os que não são sólidos). */
  canBeBase?: boolean
  /** Quadros de variação do miolo que existem na folha (padrão 15, 16, 17). */
  fills?: number[]
  /**
   * Terreno GERADO no navegador a partir de uma textura de 32×32 que se
   * repete (pisos, paredes) ou de uma cor: bordas retas, sem franja.
   * O bloco dele fica na textura TERRAIN_GEN_TEXTURE.
   */
  gen?: { url: string; x: number; y: number; size?: 32 | 64 } | { color: string }
  /** Pacote de onde veio (terrenos de pacote). */
  pack?: string
  /** Folha própria (terrenos de pacote): id em catalog/terrains.json. */
  sheet?: string
  /** Bloco LPC (3×6 ou 3×7) na folha própria: canto de cima à esquerda, px. */
  origin?: [number, number]
  /** Autotile do Tiled: máscara de cantos → tiles [x, y] na folha própria. */
  wang?: Record<number, [number, number][]>
  /** Cerca (camada de tiles): bordas ligadas (cima=1, dir=2, baixo=4, esq=8) → tiles [x, y]. */
  fence?: Record<number, [number, number][]>
  /** Tile da miniatura (wang, cerca). */
  thumb?: [number, number]
  layer?: 'ground' | 'overlay' | 'fence'
}

export interface TerrainCatalog {
  sheets: { id: string; pack: string; url: string }[]
  terrains: TerrainDef[]
}

export const TERRAIN_CATALOG_URL = 'catalog/terrains.json'
export const terrainSheetTexture = (sheet: string) => `tsheet:${sheet}`

export const TERRAIN_TEXTURE = 'terrain'
export const TERRAIN_GEN_TEXTURE = 'terrain-gen'
export const TERRAIN_URL = 'lpc/terrain.png'

const INSIDE = 'lpc/interior/inside.png'
const CASTLE = 'lpc/interior/castlefloors.png'
const HOUSE = 'lpc/interior/house.png'

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
  // Interiores (gerados): o vazio é o fundo; pisos e paredes por cima
  { id: 'void',         label: 'Vazio',            category: 'Interior', block: [0, 0], rank: 1, solid: true, edgeSolid: true, canBeBase: true, gen: { color: '#07080c' } },
  { id: 'floor-wood',   label: 'Piso de madeira',  category: 'Interior', block: [0, 0], rank: 90, gen: { url: INSIDE, x: 0, y: 128 } },
  { id: 'floor-stone',  label: 'Piso de pedra',    category: 'Interior', block: [0, 0], rank: 91, gen: { url: CASTLE, x: 192, y: 192 } },
  { id: 'rug-purple',   label: 'Tapete roxo',      category: 'Interior', block: [0, 0], rank: 92, gen: { url: CASTLE, x: 64, y: 64 } },
  { id: 'rug-blue',     label: 'Tapete azul',      category: 'Interior', block: [0, 0], rank: 93, gen: { url: CASTLE, x: 224, y: 64 } },
  { id: 'rug-red',      label: 'Tapete vermelho',  category: 'Interior', block: [0, 0], rank: 94, gen: { url: CASTLE, x: 64, y: 224 } },
  { id: 'wall-brick',   label: 'Parede de tijolo', category: 'Interior', block: [0, 0], rank: 95, solid: true, gen: { url: HOUSE, x: 32, y: 32 } },
  { id: 'wall-stone',   label: 'Parede de pedra',  category: 'Interior', block: [0, 0], rank: 96, solid: true, gen: { url: HOUSE, x: 128, y: 128 } },
]

/** Blocos por linha na textura dos terrenos gerados. */
export const GEN_COLS = 16

export const terrainById = new Map(TERRAINS.map((t) => [t.id, t]))

/** Terrenos gerados no navegador; cada um ganha um bloco na textura gerada (grade de GEN_COLS). */
export function genTerrains() {
  const list = TERRAINS.filter((t) => t.gen)
  list.forEach((t, i) => (t.block = [Math.floor(i / GEN_COLS), i % GEN_COLS]))
  return list
}

/** Imagens de onde os terrenos gerados tiram a textura. */
export function genSources() {
  return [...new Set(genTerrains().flatMap((t) => (t.gen && 'url' in t.gen ? [t.gen.url] : [])))]
}

/** Entram os terrenos dos pacotes (uma vez, no carregamento). */
export function addTerrains(list: TerrainDef[]) {
  for (const t of list) {
    if (terrainById.has(t.id)) continue
    TERRAINS.push(t)
    terrainById.set(t.id, t)
  }
}

export const isOverlay = (t: TerrainDef) => t.layer === 'overlay'
export const isFence = (t: TerrainDef) => t.layer === 'fence'

export function terrainTexture(t: TerrainDef) {
  if (t.gen) return TERRAIN_GEN_TEXTURE
  if (t.sheet) return terrainSheetTexture(t.sheet)
  return TERRAIN_TEXTURE
}
export const canBeBase = (t: TerrainDef) => !isOverlay(t) && !isFence(t) && !t.wang && (t.canBeBase ?? !t.solid)

/** Nome do quadro `n` (0..20) do terreno na textura. */
export function terrainFrame(id: string, n: number) {
  return `${id}:${n}`
}

/** Posição do quadro `n` do bloco na folha. */
export function terrainFrameRect(t: TerrainDef, n: number) {
  if (t.origin) return { x: t.origin[0] + (n % 3) * 32, y: t.origin[1] + Math.floor(n / 3) * 32 }
  const [band, col] = t.block
  return { x: col * 96 + (n % 3) * 32, y: band * 224 + Math.floor(n / 3) * 32 }
}

/** Nome do quadro de um tile de autotile (wang) na folha. */
export const wangFrame = (x: number, y: number) => `w:${x},${y}`

/** Retângulo da miniatura de um terreno (textura + posição). */
export function terrainThumb(t: TerrainDef) {
  const table = t.wang ?? t.fence
  if (table) {
    const [x, y] = t.thumb ?? table[15]?.[0] ?? Object.values(table)[0][0]
    return { x, y }
  }
  return terrainFrameRect(t, 10)
}
