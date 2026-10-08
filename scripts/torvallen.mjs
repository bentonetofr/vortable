// Gera o mundo TORVALLEN: a Grande Biblioteca do palácio, em 4 andares ligados por escadas.
//   node scripts/torvallen.mjs
// Saídas (em maps/):
//   torvallen.mundo.json          o mundo inteiro (painel Mundos → "Mundos prontos" / "Importar mundo")
//   torvallen-andar-N.zona.json   cada andar sozinho (botão "Importar" do editor)
//
// Os andares seguem a mesma grade: blocos de estantes (9 × 3 tiles) separados por becos
// de 3 tiles. As escadas ficam nos cruzamentos dos becos, nas mesmas coordenadas dos dois
// andares que ligam: subir leva ao andar de cima, descer volta.
import fs from 'node:fs'
import { applyRooms, encodeRoom } from '../src/engine/world/rooms.ts'

const TILE = 32
const W = 64, H = 56
const VW = W + 1

const cat = JSON.parse(fs.readFileSync('public/assets/catalog/objects.json', 'utf8'))
const catalog = new Map((Array.isArray(cat.objects) ? cat.objects : Object.values(cat.objects)).map((o) => [o.id, o]))
const terrains = new Map(JSON.parse(fs.readFileSync('public/assets/catalog/terrains.json', 'utf8')).terrains.map((t) => [t.id, t]))

// ── sorteio estável (o mesmo mapa a cada execução) ──
let seed = 20240609
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (list) => list[Math.floor(rnd() * list.length)]

// ── objetos e terrenos (confere se todos existem) ──
const O = {
  shelfA: 'base-cabinets@32,5', shelfB: 'base-cabinets@64,5', shelfC: 'int@32,192', shelfCobweb: 'int@0,256',
  // livros soltos (pacote "livros", arte do Vortable)
  bookStack3: 'books@2,4', bookStackTall: 'books@33,0', bookOpen: 'books@66,6', bookFlat: 'books@98,6', scrolls: 'books@130,6',
  bookMess: 'books@161,0', papersStack: 'books@195,5', bookStanding: 'books@226,2',
  table: 'furn-dark-wood@0,233', desk: 'furn-dark-wood@272,896',
  chairBack: 'furn-dark-wood@326,962', chairBack2: 'furn-dark-wood@358,962', chairLow: 'furn-dark-wood@387,960',
  armchair: 'furn-dark-wood@386,545', coffee: 'furn-dark-wood@328,258',
  clock: 'furn-dark-wood@263,748', organ: 'furn-dark-wood@161,819',
  fireplace: 'furn-dark-wood@385,752', fireplaceBrick: 'int@352,80',
  sofa3: 'uph-dourado@128,224',
  curtainsOpen: 'uph-dourado@105,0', curtainsTied: 'uph-dourado@197,1', valance: 'uph-dourado@0,0',
  windowWide: 'wd@528,25', windowSmall1: 'wd@608,25', windowSmall2: 'wd@640,9', windowTall: 'wd@704,144',
  lampWall: 'med-deco@416,64', lampTable: 'med-deco@394,66', lampDouble: 'med-deco@384,256',
  torchPost: 'base-lights@124,15', candleTable: 'int@64,352', alchemy: 'int@0,354',
  totem: 'med-deco@65,226',
  statueAngel: 'med-deco@128,292', statueMaiden: 'med-deco@4,294', statueHood: 'med-deco@97,288',
  fountain: 'med-deco@0,576', chalice: 'base-cup@0,10', notice: 'med-deco@193,160',
  ladder: 'plants@65,992',
  stairUp: 'stairs@0,0', stairDown: 'stairs@0,64',   // escadas de degraus (pacote "escadas", arte do Vortable)
  papers: 'int@289,66', rolledRed: 'med-deco@201,1216', rolledBrown: 'med-deco@201,1280',
  bush: 'plants@192,332', fern1: 'plants@1,264', fern2: 'plants@32,262', fernRed: 'plants@1,296', bamboo: 'plants@192,384',
  chest: 'base-chests@0,0', chestRound: 'base-chests@32,0',
  skull: 'int@295,32', flasks: 'int@289,128', goblet: 'int@202,1', bottle: 'int@172,1', tray: 'int@167,34', chairHigh: 'furn-dark-wood@100,231',
  web1: 'dun@288,136', web2: 'dun@296,160',
}
for (const [k, id] of Object.entries(O)) if (!catalog.has(id)) throw new Error(`Objeto não existe no catálogo: ${k} = ${id}`)
const T = { stone: 'floor-35', wood: 'floor-14', warm: 'floor-11', darkWood: 'floor-2', rug: 'rug-6', rugLounge: 'rug-10', rugAltar: 'rug-30' }
for (const [k, id] of Object.entries(T)) if (!terrains.has(id)) throw new Error(`Terreno não existe: ${k} = ${id}`)

// ── a grade dos blocos ──
const BLOCK_W = 9, BLOCK_D = 3
const COL0 = [4, 16, 28, 40, 52]         // 1º tile de cada coluna de blocos
const ROW0 = [10, 16, 22, 28, 34, 40, 46] // 1º tile de cada fileira de blocos
const ALLEY_C = [14, 26, 38, 50]         // centro dos becos verticais
const ALLEY_R = [14, 20, 26, 32, 38, 44] // centro dos becos horizontais

/** Um livro/pergaminho qualquer pra pôr sobre uma mesa. */
const bookProp = () => pick([O.bookStack3, O.bookStackTall, O.bookOpen, O.bookFlat, O.scrolls, O.bookMess, O.papersStack, O.bookStanding])

const shelfKinds = [O.shelfA, O.shelfC, O.shelfB, O.shelfA, O.shelfC, O.shelfA]

// ── um andar ──
function makeFloor({ n, id, name, floor, wall, trim, hour, base }) {
  const zone = {
    version: 1, id, name, width: W, height: H, base: base ?? floor,
    corners: new Array((W + 1) * (H + 1)).fill(''), objects: [], portals: [],
    spawn: { x: 32 * TILE + 16, y: 52 * TILE + 20 },
  }
  const room = encodeRoom({ floor, wall, trim, height: 4 })
  zone.rooms = new Array((W + 1) * (H + 1)).fill('')
  for (let y = 2; y <= 54; y++) for (let x = 2; x <= 61; x++) zone.rooms[y * VW + x] = room
  applyRooms(zone, new Array((W + 1) * (H + 1)).fill(''))
  zone.overlay = zone.overlay ?? new Array((W + 1) * (H + 1)).fill('')
  const lights = []
  const api = {
    zone, lights, n,
    isFloor: (x, y) => y >= 7 && y <= 54 && x >= 2 && x <= 61,
    paint(x0, y0, x1, y1, tid) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (api.isFloor(x, y)) zone.corners[y * VW + x] = tid },
    rug(x0, y0, x1, y1, tid) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (api.isFloor(x, y)) zone.overlay[y * VW + x] = tid },
    put(kind, tx, ty, e = {}) {
      zone.objects.push({ kind, x: Math.round(tx * TILE + TILE / 2 + (e.dx ?? 0)), y: Math.round((ty + 1) * TILE + (e.dy ?? 0)), ...(e.flip ? { flip: true } : {}), ...(e.z ? { z: e.z } : {}) })
    },
    putPx(kind, x, y, e = {}) { zone.objects.push({ kind, x: Math.round(x), y: Math.round(y), ...(e.flip ? { flip: true } : {}), ...(e.z ? { z: e.z } : {}) }) },
    light(lid, x, y, radius, color, intensity, flicker) { lights.push({ id: lid, x: Math.round(x), y: Math.round(y), radius, color, intensity, flicker }) },
  }
  zone.lighting = { place: 'indoor', hour, particles: true, clouds: false }
  zone.sound = { auto: true }
  return api
}

// parede norte: janelas, cortinas, lampiões e a fileira de estantes encostada nela
function northWall(f, { windows, big = true, skipShelves = null, cobwebs = false }) {
  const WALL_BASE = 184
  for (const [tx, id] of windows) {
    f.putPx(id, tx * TILE + 16, WALL_BASE)
    f.light(`jan-${tx}`, tx * TILE + 16, 292, 130, '#9cc4ff', 0.42, 0)
  }
  if (big) {
    const cx = 32 * TILE + 16
    for (const dx of [0, -64, 64]) f.putPx(O.windowWide, cx + dx, WALL_BASE)
    for (const dx of [-112, 112]) f.putPx(O.windowTall, cx + dx, WALL_BASE)
    f.putPx(O.curtainsTied, cx - 150, 198)
    f.putPx(O.curtainsTied, cx + 150, 198, { flip: true })
    f.putPx(O.valance, cx, 124)
    f.light('vitral', cx, 310, 260, '#a9c9ff', 0.6, 0)
  }
  for (const tx of [11, 19, 44, 52]) if (windows.some(([w]) => w === tx)) {
    f.putPx(O.curtainsOpen, tx * TILE + 16 - 40, 190)
    f.putPx(O.curtainsOpen, tx * TILE + 16 + 40, 190, { flip: true })
  }
  for (const tx of [4, 24, 40, 59]) f.putPx(O.lampWall, tx * TILE + 16, 186)
  for (let tx = 3; tx <= 60; tx++) {
    if (skipShelves && tx >= skipShelves[0] && tx <= skipShelves[1]) continue
    f.put(cobwebs && rnd() < 0.18 ? O.shelfCobweb : shelfKinds[(tx * 7) % shelfKinds.length], tx, 7)
  }
  if (cobwebs) for (let i = 0; i < 9; i++) f.putPx(pick([O.web1, O.web2]), (4 + Math.floor(rnd() * 56)) * TILE + 16, 150 + Math.floor(rnd() * 30))
}

// bloco de estantes: 9 × 3, com falhas, trepadeiras no topo e escadas encostadas
function stackBlock(f, ci, ri, { gap = 0, vines = 0.12, cobweb = 0, ladders = 0.5 } = {}) {
  const c0 = COL0[ci], r0 = ROW0[ri]
  for (let r = 0; r < BLOCK_D; r++) for (let c = 0; c < BLOCK_W; c++) {
    if (rnd() < gap) continue
    const kind = rnd() < cobweb ? O.shelfCobweb : shelfKinds[(c * 5 + r * 3 + ci * 7 + ri * 11) % shelfKinds.length]
    f.put(kind, c0 + c, r0 + r)
    if (r === 0 && rnd() < vines) f.put(pick([O.fern1, O.fern2, O.fernRed]), c0 + c, r0, { z: 60 })
  }
  // escada encostada na frente do bloco
  if (rnd() < ladders) f.put(O.ladder, c0 + 1 + Math.floor(rnd() * (BLOCK_W - 2)), r0 + BLOCK_D, { dx: 2, dy: -4 })
}

// praça de leitura: duas mesas com cadeiras e lamparinas
function tablesPlaza(f, ci, ri) {
  const c0 = COL0[ci], r0 = ROW0[ri]
  const base = (r0 + BLOCK_D - 1) * TILE + 6
  for (const cx of [(c0 + 2.5) * TILE, (c0 + 6.5) * TILE]) {
    f.putPx(O.table, cx, base)
    for (const dx of [-30, 0, 30]) {
      f.putPx(pick([O.chairBack, O.chairBack2]), cx + dx, base - 20)
      f.putPx(O.chairLow, cx + dx, base + 24)
    }
    f.putPx(bookProp(), cx - 28, base - 14, { z: 12 })
    f.putPx(O.lampTable, cx + 4, base - 12, { z: 12 })
    f.light(`mesa-${Math.round(cx)}-${r0}`, cx + 4, base - 34, 100, '#ffc980', 0.75, 0.25)
  }
}

// jardim interno: chafariz, plantas e uma estátua
function gardenPlaza(f, ci, ri) {
  const c0 = COL0[ci], r0 = ROW0[ri]
  f.put(O.fountain, c0 + 4, r0 + 2, { dy: 0 })
  f.put(O.statueMaiden, c0 + 1, r0 + 2)
  f.put(O.statueHood, c0 + 7, r0 + 2)
  for (let i = 0; i < 7; i++) f.put(pick([O.bush, O.fern1, O.fern2, O.fernRed, O.bamboo]), c0 + Math.floor(rnd() * 9), r0 + Math.floor(rnd() * 3))
  f.light(`jardim-${ci}-${ri}`, (c0 + 4.5) * TILE, (r0 + 1) * TILE, 150, '#bfe0a0', 0.5, 0.05)
}

// canto de leitura: lareira, sofá, poltronas e mesa de centro (ocupa o bloco e o beco de baixo)
function loungePlaza(f, ci, ri, brick) {
  const cx = COL0[ci] + 4, r0 = ROW0[ri]
  f.rug(cx - 3, r0 + 1, cx + 4, r0 + 5, T.rugLounge)
  f.put(brick ? O.fireplaceBrick : O.fireplace, cx, r0)
  f.light(`lareira-${cx}-${r0}`, cx * TILE + 16, r0 * TILE + 8, 170, '#ff9a4a', 0.95, 0.9)
  f.put(O.sofa3, cx, r0 + 4)
  f.put(O.armchair, cx - 3, r0 + 2, { flip: false })
  f.put(O.armchair, cx + 3, r0 + 2, { flip: true })
  f.putPx(O.coffee, cx * TILE + 16, (r0 + 3) * TILE)
  f.putPx(O.candleTable, cx * TILE + 16 - 56, (r0 + 5) * TILE)
  f.putPx(O.candleTable, cx * TILE + 16 + 56, (r0 + 5) * TILE)
}

// mesa gigante do altar: duas fileiras de mesas compridas lado a lado, cobertas de livros empilhados
// e bagunçados, com pergaminhos, frascos, uma caveira e uma cadeira encostada
function giantDesk(f, cx, base) {
  const rows = [base - 34, base]
  const tables = [-96, 0, 96]
  for (const y of rows) for (const dx of tables) f.putPx(O.table, cx + dx, y)
  // livros: montes espalhados, uns sobre os outros (z maior = mais alto), virados pra todo lado
  for (const y of rows) {
    for (let i = 0; i < 16; i++) {
      const x = cx - 138 + (i + rnd() * 0.8) * 17
      const yy = y - 10 + Math.floor(rnd() * 14) - 6
      const z = 13 + Math.floor(rnd() * 5)
      f.putPx(bookProp(), x, yy, { z, flip: rnd() < 0.5 })
      if (rnd() < 0.55) f.putPx(bookProp(), x + (rnd() - 0.5) * 12, yy, { z: z + 9 + Math.floor(rnd() * 4), flip: rnd() < 0.5 })
      if (rnd() < 0.25) f.putPx(bookProp(), x + (rnd() - 0.5) * 10, yy - 1, { z: z + 19, flip: rnd() < 0.5 })
    }
  }
  // o resto da bagunça: cálices, frascos, caveira, taças e lamparinas
  f.putPx(O.chalice, cx - 118, base - 34 - 4, { z: 14 })
  f.putPx(O.chalice, cx + 118, base - 34 - 4, { z: 14 })
  f.putPx(O.skull, cx - 40, base - 40, { z: 16 })
  f.putPx(O.flasks, cx + 50, base - 8, { z: 14 })
  f.putPx(O.flasks, cx - 108, base - 6, { z: 14, flip: true })
  f.putPx(O.goblet, cx + 12, base - 4, { z: 14 })
  f.putPx(O.bottle, cx - 70, base - 2, { z: 14 })
  f.putPx(O.tray, cx + 88, base - 40, { z: 15 })
  f.putPx(O.lampTable, cx - 12, base - 38, { z: 14 })
  f.putPx(O.lampTable, cx + 134, base - 30, { z: 14 })
  f.putPx(O.lampTable, cx - 140, base - 36, { z: 14 })
  f.light('mesa-altar-1', cx - 12, base - 70, 120, '#ffc980', 0.8, 0.25)
  f.light('mesa-altar-2', cx + 134, base - 62, 110, '#ffc980', 0.7, 0.25)
  f.light('mesa-altar-3', cx - 140, base - 68, 110, '#ffc980', 0.7, 0.25)
  // cadeira encostada na mesa (de frente pra ela) e outra puxada de lado
  f.putPx(O.chairHigh, cx + 6, base + 22)
  f.putPx(O.chairBack2, cx - 74, base + 36, { flip: true })
}

// escada de degraus (3 tiles de largura × 2 de altura) cruzando o beco; a saída é a faixa de baixo
function stairVisual(f, c, r, up) {
  f.putPx(up ? O.stairUp : O.stairDown, c * TILE + 16, (r + 1) * TILE)
  f.light(`escada-${c}-${r}`, c * TILE + 16, (r - 0.2) * TILE, 150, up ? '#ffd9a0' : '#ffb870', 0.8, 0.2)
  f.put(O.lampDouble, c - 1, r + 1)
  f.put(O.notice, c + 1, r + 1)
}

// luzes e lampiões nos cruzamentos dos becos
function alleyLights(f, { every = 2, color = '#ffcf8a', intensity = 0.75, radius = 150, lamps = true }) {
  let i = 0
  for (const c of ALLEY_C) for (const r of ALLEY_R) {
    if ((i++) % every !== 0) continue
    f.light(`beco-${c}-${r}`, c * TILE + 16, r * TILE + 8, radius, color, intensity, 0.18)
    if (lamps && !f.zone.portals.some((p) => Math.abs(p.x / TILE - c) < 3 && Math.abs(p.y / TILE - r) < 3)) f.put(O.lampDouble, c, r)
  }
}

// papéis caídos nos becos
function papers(f, count) {
  for (let i = 0; i < count; i++) {
    const tx = 4 + Math.floor(rnd() * 56), ty = 8 + Math.floor(rnd() * 45)
    const inBlock = COL0.some((c0) => tx >= c0 && tx < c0 + BLOCK_W) && ROW0.some((r0) => ty >= r0 && ty < r0 + BLOCK_D)
    if (!inBlock) f.put(O.papers, tx, ty)
  }
}

const matrixOf = (rows) => rows.map((r) => r.replace(/\s/g, '').split(''))

function buildBlocks(f, matrix, opts) {
  matrix.forEach((row, ri) => row.forEach((cell, ci) => {
    if (cell === 'S') stackBlock(f, ci, ri, opts.stack)
    else if (cell === 'H') stackBlock(f, ci, ri, { ...opts.stack, gap: 0.28, ladders: 0.8 })
    else if (cell === 'T') tablesPlaza(f, ci, ri)
    else if (cell === 'G') gardenPlaza(f, ci, ri)
    else if (cell === 'L') loungePlaza(f, ci, ri, ci > 2)
  }))
}

// ═══ ANDAR 1: o Grande Salão ═══
const F1 = makeFloor({ n: 1, id: 'torvallen-biblioteca-1', name: 'Biblioteca de Torvallen — Térreo (Grande Salão)', floor: T.stone, wall: 'wall-49', trim: 'ceil-25', hour: 17.4 })
{
  const f = F1
  f.paint(3, 8, 24, 53, T.wood); f.paint(40, 8, 60, 53, T.wood)
  f.paint(27, 7, 37, 12, T.warm)
  f.rug(29, 8, 36, 53, T.rug)           // tapete da nave, da entrada ao altar
  f.rug(30, 9, 35, 11, T.rugAltar)
  northWall(f, { windows: [[11, O.windowWide], [19, O.windowWide], [44, O.windowWide], [52, O.windowWide], [7, O.windowSmall1], [56, O.windowSmall2], [15, O.windowSmall2], [48, O.windowSmall1]], skipShelves: [26, 37] })
  f.put(O.clock, 26, 7); f.put(O.clock, 37, 7)
  f.put(O.organ, 21, 7, { dx: 24 })
  buildBlocks(f, matrixOf([
    'S S . S S', 'S H . H S', 'S S . S S', 'H S . S H', 'S S . S S', 'S H . H S', 'S L . L S',
  ]), { stack: { vines: 0.1, cobweb: 0.03 } })
  // nave: pilares, mesas de leitura nos becos centrais e o altar
  for (const ty of [12, 19, 26, 33, 40, 47]) for (const tx of [27, 37]) f.put(O.totem, tx, ty)
  for (const cx of [26.5 * TILE, 38.5 * TILE]) {
    for (const ty of [16, 22, 28, 34, 40]) {
      const base = (ty + 1) * TILE
      f.putPx(O.table, cx, base)
      for (const dx of [-30, 0, 30]) { f.putPx(pick([O.chairBack, O.chairBack2]), cx + dx, base - 20); f.putPx(O.chairLow, cx + dx, base + 24) }
      f.putPx(bookProp(), cx - 28, base - 14, { z: 12 })
      f.putPx(O.lampTable, cx + 4, base - 12, { z: 12 })
      f.light(`mesa-${Math.round(cx)}-${ty}`, cx + 4, base - 34, 96, '#ffc980', 0.75, 0.25)
    }
  }
  const altar = 9
  f.put(O.statueAngel, 26, altar); f.put(O.statueAngel, 38, altar, { flip: true })
  f.put(O.statueMaiden, 24, altar + 1); f.put(O.statueMaiden, 40, altar + 1, { flip: true })
  giantDesk(f, 32 * TILE + 16, (altar + 1) * TILE + 12)
  f.put(O.candleTable, 29, 11); f.put(O.candleTable, 35, 11)
  f.light('altar', 32 * TILE + 16, 9 * TILE, 200, '#ffd9a0', 0.7, 0.1)
  for (const ty of [11, 20, 29, 38, 46]) f.light(`lustre-${ty}`, 32 * TILE + 16, ty * TILE, 270, '#ffd49a', 0.85, 0.14)
  // entrada ao sul: mesa da bibliotecária e postes de luz
  f.putPx(O.table, 32 * TILE + 16, 50 * TILE)
  f.putPx(O.chairBack, 32 * TILE + 16, 50 * TILE - 22)
  f.putPx(bookProp(), 32 * TILE + 16 - 26, 50 * TILE - 12, { z: 12 })
  f.putPx(O.lampTable, 32 * TILE + 16 + 8, 50 * TILE - 10, { z: 12 })
  f.put(O.torchPost, 28, 52); f.put(O.torchPost, 36, 52)
  f.light('entrada-e', 28 * TILE + 16, 52 * TILE - 20, 150, '#ffb25e', 0.8, 0.6)
  f.light('entrada-d', 36 * TILE + 16, 52 * TILE - 20, 150, '#ffb25e', 0.8, 0.6)
  f.zone.portals.push({ id: 'saida-palacio', name: 'Saída para o palácio', x: 30 * TILE, y: 53 * TILE, w: 5 * TILE, h: TILE, to: null })
  f.put(O.rolledRed, 6, 9, { dy: -4 }); f.put(O.rolledBrown, 56, 9, { dy: -4 })
}

// ═══ ANDAR 2: a Galeria dos Corredores ═══
const F2 = makeFloor({ n: 2, id: 'torvallen-biblioteca-2', name: 'Biblioteca de Torvallen — 2º andar (Galeria dos Corredores)', floor: T.wood, wall: 'wall-49', trim: 'ceil-25', hour: 16.8 })
{
  const f = F2
  f.rug(25, 8, 27, 53, T.rug); f.rug(37, 8, 39, 53, T.rug)   // tapetes nos becos longos
  northWall(f, { windows: [[11, O.windowWide], [19, O.windowWide], [44, O.windowWide], [52, O.windowWide], [7, O.windowSmall1], [56, O.windowSmall2]] })
  buildBlocks(f, matrixOf([
    'S S H S S', 'S H T H S', 'S S S S S', 'H S G S H', 'S S S S S', 'S T H T S', 'S S S S S',
  ]), { stack: { vines: 0.14, cobweb: 0.05 } })
}

// ═══ ANDAR 3: os Arquivos Antigos ═══
const F3 = makeFloor({ n: 3, id: 'torvallen-biblioteca-3', name: 'Biblioteca de Torvallen — 3º andar (Arquivos Antigos)', floor: T.darkWood, wall: 'wall-209', trim: 'ceil-3', hour: 18.6 })
{
  const f = F3
  northWall(f, { windows: [[11, O.windowSmall1], [19, O.windowSmall2], [44, O.windowSmall2], [52, O.windowSmall1]], big: false, cobwebs: true })
  buildBlocks(f, matrixOf([
    'S S S S S', 'S H S H S', 'S S H S S', 'S S S S S', 'H S S S H', 'S S H S S', 'S S S S S',
  ]), { stack: { vines: 0.3, cobweb: 0.12, ladders: 0.7 } })
}

// ═══ ANDAR 4: a Torre dos Pergaminhos ═══
const F4 = makeFloor({ n: 4, id: 'torvallen-biblioteca-4', name: 'Biblioteca de Torvallen — 4º andar (Torre dos Pergaminhos)', floor: T.wood, wall: 'wall-33', trim: 'ceil-26', hour: 14.5 })
{
  const f = F4
  f.paint(24, 28, 40, 40, T.warm)
  f.rug(27, 29, 37, 39, T.rugAltar)
  northWall(f, { windows: [[11, O.windowWide], [19, O.windowWide], [44, O.windowWide], [52, O.windowWide], [7, O.windowSmall1], [56, O.windowSmall2]] })
  buildBlocks(f, matrixOf([
    'S S S S S', 'S H H H S', 'S H A H S', 'S A A A S', 'S H A H S', 'S H H H S', 'S S S S S',
  ]), { stack: { vines: 0.16, cobweb: 0.04 } })
  // átrio central: mesa de estudo, estátuas, chafariz e o lustre grande
  const cx = 32 * TILE + 16
  f.putPx(O.table, cx - 48, 35 * TILE); f.putPx(O.table, cx + 48, 35 * TILE)
  for (const dx of [-78, -48, -18, 18, 48, 78]) { f.putPx(O.chairBack, cx + dx, 35 * TILE - 20); f.putPx(O.chairLow, cx + dx, 35 * TILE + 24) }
  f.putPx(O.alchemy, cx, 31 * TILE)
  f.put(O.statueAngel, 25, 31); f.put(O.statueAngel, 39, 31, { flip: true })
  f.put(O.statueHood, 25, 39); f.put(O.statueHood, 39, 39, { flip: true })
  f.put(O.fountain, 32, 38)
  f.light('atrio', cx, 34 * TILE, 330, '#fff0c8', 0.95, 0.06)
  for (const [tx, ty] of [[28, 30], [36, 30], [28, 38], [36, 38]]) f.put(O.totem, tx, ty)
  f.put(O.chest, 4, 53); f.put(O.chestRound, 59, 53)
}

// ── escadas entre os andares ──
const floors = [F1, F2, F3, F4]
const links = [
  { lo: 1, hi: 2, c: 14, r: 20, tag: 'oeste' },
  { lo: 1, hi: 2, c: 50, r: 38, tag: 'leste' },
  { lo: 2, hi: 3, c: 26, r: 14, tag: 'norte' },
  { lo: 2, hi: 3, c: 38, r: 44, tag: 'sul' },
  { lo: 3, hi: 4, c: 14, r: 32, tag: 'oeste' },
  { lo: 3, hi: 4, c: 50, r: 20, tag: 'leste' },
]
const ordinal = ['', 'térreo', '2º andar', '3º andar', '4º andar']
for (const L of links) {
  const lo = floors[L.lo - 1], hi = floors[L.hi - 1]
  const upId = `sobe-${L.tag}-${L.lo}`, downId = `desce-${L.tag}-${L.hi}`
  const rect = { x: (L.c - 1) * TILE, y: L.r * TILE, w: 3 * TILE, h: TILE }
  lo.zone.portals.push({ id: upId, name: `Subir ao ${ordinal[L.hi]} (escada ${L.tag})`, ...rect, to: { zone: hi.zone.id, portal: downId } })
  hi.zone.portals.push({ id: downId, name: `Descer ao ${ordinal[L.lo]} (escada ${L.tag})`, ...rect, to: { zone: lo.zone.id, portal: upId } })
  stairVisual(lo, L.c, L.r, true)
  stairVisual(hi, L.c, L.r, false)
}

// ── luzes de beco e papéis (depois das escadas, pra não pôr lampião em cima delas) ──
alleyLights(F1, { every: 3, intensity: 0.7 }); papers(F1, 70)
alleyLights(F2, { every: 2, intensity: 0.75 }); papers(F2, 90)
alleyLights(F3, { every: 3, intensity: 0.6, color: '#ffb870', radius: 130 }); papers(F3, 130)
alleyLights(F4, { every: 3, intensity: 0.8, color: '#ffe3b0', radius: 160 }); papers(F4, 60)

for (const f of floors) f.zone.lights = f.lights

// ── os arquivos ──
const zones = floors.map((f) => f.zone)
const world = {
  version: 1, id: 'mundo-torvallen', name: 'TORVALLEN', start: F1.zone.id,
  layout: Object.fromEntries(zones.map((z, i) => [z.id, { x: 0, y: -i }])),
}
fs.mkdirSync('maps', { recursive: true })
for (const f of floors) fs.writeFileSync(`maps/torvallen-andar-${f.n}.zona.json`, JSON.stringify(f.zone))
fs.rmSync('maps/torvallen-biblioteca.zona.json', { force: true })
fs.writeFileSync('maps/torvallen.mundo.json', JSON.stringify({ format: 'vortable-world', version: 1, world, zones }))
for (const z of zones) console.log(`${z.name}: ${z.objects.length} objetos, ${z.lights.length} luzes, ${z.portals.length} saídas`)
