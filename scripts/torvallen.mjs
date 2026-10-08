// Gera o mundo TORVALLEN: por enquanto uma zona só, a Grande Biblioteca do palácio.
//   node scripts/torvallen.mjs
// Saídas (em maps/):
//   torvallen.mundo.json   o mundo inteiro (botão "Importar mundo" do painel Mundos)
//   torvallen-biblioteca.zona.json   só a zona (botão "Importar" do editor)
import fs from 'node:fs'
import { applyRooms, encodeRoom } from '../src/engine/world/rooms.ts'

const TILE = 32
const W = 64, H = 56
const cat = JSON.parse(fs.readFileSync('public/assets/catalog/objects.json', 'utf8'))
const catalog = new Map((Array.isArray(cat.objects) ? cat.objects : Object.values(cat.objects)).map((o) => [o.id, o]))
const terrains = new Map(JSON.parse(fs.readFileSync('public/assets/catalog/terrains.json', 'utf8')).terrains.map((t) => [t.id, t]))

// ── sorteio estável (mesmo mapa a cada execução) ──
let seed = 20240609
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (list) => list[Math.floor(rnd() * list.length)]

// ── ids (confere se todos existem no catálogo) ──
const O = {
  shelfA: 'base-cabinets@32,5',        // estante com livros
  shelfB: 'base-cabinets@64,5',        // estante com livros 2 (meio vazia)
  shelfC: 'int@32,192',                // estante de livros colorida
  books: 'int@224,208',                // livros na prateleira (pilha)
  table: 'furn-dark-wood@0,233',       // mesa comprida
  desk: 'furn-dark-wood@272,896',      // mesa de trabalho
  chairGothicBack: 'furn-dark-wood@326,962',
  chairGothicBack2: 'furn-dark-wood@358,962',
  chairGothicLow: 'furn-dark-wood@387,960',
  armchair: 'furn-dark-wood@386,545',
  coffee: 'furn-dark-wood@328,258',    // mesa de centro comprida
  clock: 'furn-dark-wood@263,748',
  organ: 'furn-dark-wood@161,819',
  fireplace: 'furn-dark-wood@385,752',
  fireplaceBrick: 'int@352,80',
  sofa3: 'uph-dourado@128,224',
  sofaCarved: 'uph-dourado@0,337',
  curtainsOpen: 'uph-dourado@105,0',
  curtainsTied: 'uph-dourado@197,1',
  valance: 'uph-dourado@0,0',
  windowWide: 'wd@528,25',             // janela de vitral azul larga
  windowSmall1: 'wd@608,25',
  windowSmall2: 'wd@640,9',
  windowTall: 'wd@704,144',            // vitral azul alto e estreito
  lampWall: 'med-deco@416,64',         // lampião aceso
  lampTable: 'med-deco@394,66',        // lamparina
  lampDouble: 'med-deco@384,256',      // lampiões duplos
  torchPost: 'base-lights@124,15',
  candleTable: 'int@64,352',           // mesinha com vela
  column: 'med-deco@65,226',           // totem de pedra: pilar da nave
  statueAngel: 'med-deco@128,292',
  statueMaiden: 'med-deco@4,294',
  statueHood: 'med-deco@97,288',
  pedestal: 'med-deco@99,234',
  chalice: 'base-cup@0,10',
  ladder: 'plants@65,992',
  papers: 'int@289,66',
  rolledRed: 'med-deco@201,1216',
  rolledBrown: 'med-deco@201,1280',
  bush: 'plants@192,332',
  fern1: 'plants@1,264',
  fern2: 'plants@32,262',
  chest: 'base-chests@0,0',
  chestRound: 'base-chests@32,0',
}
for (const [k, id] of Object.entries(O)) if (!catalog.has(id)) throw new Error(`Objeto não existe no catálogo: ${k} = ${id}`)
const size = (id) => catalog.get(id)

const T = { stoneFloor: 'floor-35', woodFloor: 'floor-14', warmFloor: 'floor-11', wall: 'wall-49', trim: 'ceil-25', rug: 'rug-6', rugLounge: 'rug-10', rugAltar: 'rug-30' }
for (const [k, id] of Object.entries(T)) if (!terrains.has(id)) throw new Error(`Terreno não existe: ${k} = ${id}`)

// ── a zona ──
const VW = W + 1
const zone = {
  version: 1,
  id: 'torvallen-biblioteca',
  name: 'Grande Biblioteca de Torvallen',
  width: W,
  height: H,
  base: T.stoneFloor,
  corners: new Array((W + 1) * (H + 1)).fill(''),
  objects: [],
  portals: [],
  spawn: { x: 32 * TILE + 16, y: 52 * TILE + 20 },
}

// salão principal: piso, parede de pedra escura (4 de altura) e moldura de pedra
const room = encodeRoom({ floor: T.stoneFloor, wall: T.wall, trim: T.trim, height: 4 })
zone.rooms = new Array((W + 1) * (H + 1)).fill('')
for (let y = 2; y <= 54; y++) for (let x = 2; x <= 61; x++) zone.rooms[y * VW + x] = room
applyRooms(zone, new Array((W + 1) * (H + 1)).fill(''))

// pisos por região (só nos vértices de piso: a parede fica como está)
const isFloor = (x, y) => y >= 7 && y <= 54 && x >= 2 && x <= 61
const paint = (x0, y0, x1, y1, id) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (isFloor(x, y)) zone.corners[y * VW + x] = id
}
paint(3, 8, 18, 53, T.woodFloor)      // ala oeste: madeira escura
paint(46, 8, 60, 53, T.woodFloor)     // ala leste
paint(27, 7, 37, 12, T.warmFloor)     // altar
paint(19, 47, 27, 53, T.warmFloor)    // canto de leitura oeste
paint(37, 47, 45, 53, T.warmFloor)    // canto de leitura leste

// tapetes (camada de cima, só sobre o piso)
zone.overlay = zone.overlay ?? new Array((W + 1) * (H + 1)).fill('')
const rug = (x0, y0, x1, y1, id) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (isFloor(x, y)) zone.overlay[y * VW + x] = id
}
rug(29, 8, 36, 53, T.rug)             // tapete da nave, da entrada ao altar
rug(20, 48, 26, 52, T.rugLounge)      // canto oeste
rug(38, 48, 44, 52, T.rugLounge)      // canto leste
rug(30, 9, 35, 11, T.rugAltar)       // degrau do altar

// ── objetos ──
const put = (kind, tx, ty, extra = {}) => {
  // tx/ty = tile; o objeto fica no meio do tile, com o pé na borda de baixo (ty+1)
  zone.objects.push({ kind, x: Math.round(tx * TILE + TILE / 2 + (extra.dx ?? 0)), y: Math.round((ty + 1) * TILE + (extra.dy ?? 0)), ...(extra.flip ? { flip: true } : {}), ...(extra.z ? { z: extra.z } : {}) })
}
const putPx = (kind, x, y, extra = {}) => zone.objects.push({ kind, x: Math.round(x), y: Math.round(y), ...(extra.flip ? { flip: true } : {}), ...(extra.z ? { z: extra.z } : {}) })
const lights = []
const light = (id, x, y, radius, color, intensity, flicker) => lights.push({ id, x: Math.round(x), y: Math.round(y), radius, color, intensity, flicker })

// parede norte: vitrais, cortinas, lampiões
const WALL_BASE = 184
const windows = [[11, O.windowWide], [19, O.windowWide], [44, O.windowWide], [52, O.windowWide], [7, O.windowSmall1], [56, O.windowSmall2], [15, O.windowSmall2], [48, O.windowSmall1]]
for (const [tx, id] of windows) {
  putPx(id, tx * TILE + 16, WALL_BASE)
  light(`jan-${tx}`, tx * TILE + 16, 292, 130, '#9cc4ff', 0.42, 0)
}
// grande vitral central: três vitrais lado a lado, cortinas e bandô dourado
putPx(O.windowWide, 32 * TILE + 16, WALL_BASE)
putPx(O.windowWide, 32 * TILE + 16 - 64, WALL_BASE)
putPx(O.windowWide, 32 * TILE + 16 + 64, WALL_BASE)
putPx(O.windowTall, 32 * TILE + 16 - 112, WALL_BASE)
putPx(O.windowTall, 32 * TILE + 16 + 112, WALL_BASE)
putPx(O.curtainsTied, 32 * TILE + 16 - 150, 198)
putPx(O.curtainsTied, 32 * TILE + 16 + 150, 198, { flip: true })
putPx(O.valance, 32 * TILE + 16, 124)
light('vitral', 32 * TILE + 16, 310, 260, '#a9c9ff', 0.6, 0)
// cortinas nos vitrais laterais
for (const tx of [11, 19, 44, 52]) {
  putPx(O.curtainsOpen, tx * TILE + 16 - 40, 190)
  putPx(O.curtainsOpen, tx * TILE + 16 + 40, 190, { flip: true })
}
for (const tx of [4, 24, 40, 59]) putPx(O.lampWall, tx * TILE + 16, 186)

// estantes da parede norte (com o vão do altar no meio)
const shelfKinds = [O.shelfA, O.shelfC, O.shelfB, O.shelfA, O.shelfC]
for (let tx = 3; tx <= 60; tx++) {
  if (tx >= 26 && tx <= 37) continue
  put(shelfKinds[(tx * 7) % shelfKinds.length], tx, 7)
}
put(O.clock, 26, 7)
put(O.clock, 37, 7)

// alas de estantes: fileiras com vãos alternados (um labirinto de corredores)
const ROWS = [12, 17, 22, 27, 32, 37, 42, 47]
const wing = (from, to, mirror) => {
  ROWS.forEach((ty, i) => {
    const gap = i % 2 === 0 ? [9, 10] : [5, 6]
    const gapTiles = gap.map((g) => (mirror ? 63 - g : g))
    for (let tx = from; tx <= to; tx++) {
      if (gapTiles.includes(tx)) continue
      put(shelfKinds[(tx * 5 + i * 3) % shelfKinds.length], tx, ty)
    }
    // escada encostada, plantas subindo pelas estantes, papéis pelo chão
    const gx = gapTiles[0] + (mirror ? -1 : 1) * 2
    if (i % 2 === 0) put(O.ladder, gx, ty + 1, { dx: 4 })
    if (rnd() < 0.7) put(pick([O.fern1, O.fern2]), from + 1 + Math.floor(rnd() * (to - from - 1)), ty + 1, { dy: -2 })
    if (rnd() < 0.8) put(O.papers, from + 1 + Math.floor(rnd() * (to - from - 1)), ty + 2)
  })
}
wing(4, 17, false)
wing(46, 59, true)

// nave: colunas, mesas de leitura com cadeiras, lamparinas e livros
const COLS_X = [27, 37]
for (const ty of [12, 19, 26, 33, 40, 47]) for (const tx of COLS_X) put(O.column, tx, ty)

const tableRows = [15, 21, 27, 33, 39, 45]
for (const side of [{ cx: 22.5 * TILE }, { cx: 41.5 * TILE }]) {
  tableRows.forEach((ty, i) => {
    const base = (ty + 1) * TILE
    putPx(O.table, side.cx, base)
    // cadeiras: atrás (costas altas) e na frente
    for (const dx of [-30, 0, 30]) {
      putPx(pick([O.chairGothicBack, O.chairGothicBack2]), side.cx + dx, base - 20)
      putPx(O.chairGothicLow, side.cx + dx, base + 24)
    }
    // livros e lamparina sobre a mesa
    putPx(O.books, side.cx - 28, base - 14, { z: 12 })
    putPx(O.lampTable, side.cx + 4, base - 12, { z: 12 })
    putPx(O.books, side.cx + 30, base - 10, { z: 12, flip: i % 2 === 0 })
    light(`mesa-${Math.round(side.cx)}-${ty}`, side.cx + 4, base - 34, 96, '#ffc980', 0.75, 0.25)
  })
}

// altar ao norte: estátuas, pedestais e o cálice
const altar = 9
put(O.statueAngel, 28, altar)
put(O.statueAngel, 36, altar, { flip: true })
put(O.statueMaiden, 25, altar + 1)
put(O.statueMaiden, 39, altar + 1, { flip: true })
putPx(O.desk, 32 * TILE + 16, (altar + 1) * TILE)
put(O.chalice, 30, altar)
put(O.chalice, 34, altar)
put(O.candleTable, 29, 11)
put(O.candleTable, 35, 11)
put(O.statueHood, 18, 11)
put(O.statueHood, 45, 11, { flip: true })
light('altar', 32 * TILE + 16, 9 * TILE, 200, '#ffd9a0', 0.7, 0.1)

// órgão no canto da ala oeste
// (fica contra a parede norte, depois das estantes)
put(O.organ, 21, 7, { dx: 24 })

// cantos de leitura: lareira, sofás, poltronas e mesa de centro
const lounge = (cx, fire, mirror) => {
  put(fire, cx, 47)
  light(`lareira-${cx}`, cx * TILE + 16, 47 * TILE + 8, 160, '#ff9a4a', 0.95, 0.9)
  put(O.sofa3, cx, 51)
  put(O.armchair, cx - 3, 49, { flip: mirror })
  put(O.armchair, cx + 3, 49, { flip: !mirror })
  putPx(O.coffee, cx * TILE + 16, 50 * TILE)
  putPx(O.candleTable, cx * TILE + 16 - 52, 52 * TILE)
  putPx(O.candleTable, cx * TILE + 16 + 52, 52 * TILE)
}
lounge(23, O.fireplace, false)
lounge(41, O.fireplaceBrick, true)

// entrada ao sul: mesa da bibliotecária, postes de luz e pilhas de livros
putPx(O.table, 32 * TILE + 16, 50 * TILE)
putPx(O.chairGothicBack, 32 * TILE + 16, 50 * TILE - 22)
putPx(O.books, 32 * TILE + 16 - 26, 50 * TILE - 12, { z: 12 })
putPx(O.lampTable, 32 * TILE + 16 + 8, 50 * TILE - 10, { z: 12 })
put(O.torchPost, 28, 52)
put(O.torchPost, 36, 52)
light('entrada-e', 28 * TILE + 16, 52 * TILE - 20, 150, '#ffb25e', 0.8, 0.6)
light('entrada-d', 36 * TILE + 16, 52 * TILE - 20, 150, '#ffb25e', 0.8, 0.6)

// candelabros no ar: lustres ao longo da nave
for (const ty of [11, 20, 29, 38, 46]) light(`lustre-${ty}`, 32 * TILE + 16, ty * TILE, 270, '#ffd49a', 0.85, 0.14)

// detalhes: tapetes enrolados, baús, moitas, papéis perdidos
put(O.rolledRed, 6, 10, { dy: -4 })
put(O.rolledBrown, 56, 10, { dy: -4 })
put(O.chest, 4, 53)
put(O.chestRound, 59, 53)
put(O.bush, 3, 51)
put(O.bush, 60, 51, { flip: true })
put(O.bush, 3, 10)
put(O.bush, 60, 10, { flip: true })
for (let i = 0; i < 26; i++) {
  const tx = 20 + Math.floor(rnd() * 24), ty = 9 + Math.floor(rnd() * 42)
  if (tx >= 27 && tx <= 37) continue
  put(O.papers, tx, ty)
}

// saída: a porta da biblioteca (ainda não ligada a outra zona)
zone.portals.push({ id: 'saida-palacio', name: 'Saída para o palácio', x: 30 * TILE, y: 53 * TILE, w: 5 * TILE, h: TILE, to: null })

zone.lights = lights
zone.lighting = { place: 'indoor', hour: 17.4, particles: true, clouds: false }
zone.sound = { auto: true }

// ── os arquivos ──
const world = { version: 1, id: 'mundo-torvallen', name: 'TORVALLEN', start: zone.id, layout: { [zone.id]: { x: 0, y: 0 } } }
fs.mkdirSync('maps', { recursive: true })
fs.writeFileSync('maps/torvallen-biblioteca.zona.json', JSON.stringify(zone))
fs.writeFileSync('maps/torvallen.mundo.json', JSON.stringify({ format: 'vortable-world', version: 1, world, zones: [zone] }))
console.log(`Zona ${zone.width}x${zone.height}, ${zone.objects.length} objetos, ${zone.lights.length} luzes`)
