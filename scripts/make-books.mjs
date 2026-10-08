// Gera a arte dos livros soltos (pacote "livros", arte original do Vortable):
//   node scripts/make-books.mjs && node scripts/build-catalog.mjs --pack livros
// Oito peças de 32×24: pilhas de livros, livro aberto, pergaminhos e folhas soltas.
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'

const CW = 32, CH = 24, N = 8
const png = new PNG({ width: CW * N, height: CH })
png.data.fill(0)

const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
const shade = (c, f) => '#' + hex(c).map((v) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0')).join('')
const noise = (x, y, s) => {
  let h = Math.imul(x + 1, 374761393) + Math.imul(y + 1, 668265263) + Math.imul(s, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function px(cell, x, y, c) {
  if (x < 0 || x >= CW || y < 0 || y >= CH) return
  const i = (y * png.width + cell * CW + x) * 4
  const [r, g, b] = hex(c)
  png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255
}
const fill = (cell, x0, y0, w, h, c, seed = 0, grain = 0.05) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px(cell, x, y, shade(c, 1 + (noise(x, y, seed) - 0.5) * 2 * grain))
}
const OUT = '#1d1612'
const COVERS = ['#8b2f2f', '#2f4f8b', '#2f6b45', '#6b4426', '#5b3a7a', '#a8782a', '#2f6b6b', '#7a3a4a']
const PAGE = '#e8dcc0'

/** Um livro deitado visto de cima/de frente: capa, lombada à esquerda e a borda das páginas na frente. */
function book(cell, x, y, w, h, cover, seed) {
  fill(cell, x, y, w, h - 3, cover, seed, 0.06)                // capa de cima
  fill(cell, x, y, 3, h - 3, shade(cover, 0.7), seed + 1)      // lombada
  fill(cell, x + 3, y + h - 3, w - 3, 2, PAGE, seed + 2, 0.03)  // páginas (borda da frente)
  for (let i = x + 4; i < x + w; i += 2) px(cell, i, y + h - 2, shade(PAGE, 0.82)) // linhas das folhas
  fill(cell, x, y + h - 1, w, 1, shade(cover, 0.5), seed + 3)   // base da capa
  // detalhe dourado na lombada
  px(cell, x + 1, y + 2, '#d8b45a'); px(cell, x + 1, y + h - 6, '#d8b45a')
  // contorno
  for (let i = x; i < x + w; i++) { px(cell, i, y - 1, OUT); px(cell, i, y + h, OUT) }
  for (let j = y; j < y + h; j++) { px(cell, x - 1, j, OUT); px(cell, x + w, j, OUT) }
}

/** Pilha de livros: de baixo pra cima, cada um um pouco torto. */
function stack(cell, bottom, items, seed) {
  let y = bottom
  items.forEach(([w, h, dx, cover], i) => {
    y -= h
    book(cell, 4 + dx, y, w, h, cover, seed + i * 7)
  })
}

// 0: três livros empilhados
stack(0, 21, [[22, 6, 0, COVERS[0]], [20, 5, 2, COVERS[1]], [18, 5, -1, COVERS[4]]], 10)
// 1: pilha alta e torta de cinco
stack(1, 22, [[22, 5, 0, COVERS[3]], [20, 5, 3, COVERS[5]], [21, 5, -2, COVERS[2]], [17, 4, 2, COVERS[0]], [15, 4, -1, COVERS[1]]], 20)
// 2: livro aberto
{
  const c = 2
  fill(c, 3, 12, 26, 7, '#5a3820', 30, 0.05)                                 // capas
  fill(c, 4, 7, 12, 11, PAGE, 31, 0.03); fill(c, 16, 7, 12, 11, shade(PAGE, 0.95), 32, 0.03)
  for (let k = 0; k < 4; k++) { for (let x = 6; x < 14; x++) px(c, x, 9 + k * 2, '#8a7c62'); for (let x = 18; x < 26; x++) px(c, x, 9 + k * 2, '#8a7c62') }
  for (let y = 7; y < 18; y++) px(c, 16, y, '#9a8c70')
  for (let x = 3; x < 29; x++) { px(c, x, 6, OUT); px(c, x, 19, OUT) }
  for (let y = 6; y < 20; y++) { px(c, 2, y, OUT); px(c, 29, y, OUT) }
}
// 3: dois livros deitados lado a lado
book(3, 3, 14, 17, 7, COVERS[6], 40)
book(3, 11, 7, 18, 7, COVERS[7], 41)
// 4: dois pergaminhos enrolados
for (const [x, y, w] of [[3, 13, 25], [6, 7, 22]]) {
  fill(4, x, y, w, 6, '#d9c9a0', 50 + y, 0.05)
  fill(4, x, y + 4, w, 2, '#a89868', 51 + y, 0.04)
  fill(4, x - 1, y - 1, 2, 8, '#6b4426', 52); fill(4, x + w - 1, y - 1, 2, 8, '#6b4426', 53)
  for (let i = x; i < x + w; i++) { px(4, i, y - 1, OUT); px(4, i, y + 6, OUT) }
}
px(4, 15, 15, '#b03a3a'); px(4, 16, 15, '#b03a3a')
// 5: pilha grande e bagunçada (aberto, fechado, de lado)
stack(5, 22, [[24, 6, 0, COVERS[1]], [22, 5, 3, COVERS[0]], [24, 6, -2, COVERS[4]], [18, 5, 2, COVERS[3]], [16, 4, 4, COVERS[5]]], 60)
// 6: folhas soltas empilhadas
for (let k = 0; k < 5; k++) {
  const x = 4 + k * 2, y = 14 - k * 2 + (k % 2)
  fill(6, x, y, 20, 7, k % 2 ? '#efe5ca' : '#e3d6b6', 70 + k, 0.03)
  for (let i = x; i < x + 20; i++) { px(6, i, y - 1, '#8f8468'); px(6, i, y + 7, '#8f8468') }
  for (let j = y; j < y + 7; j++) { px(6, x - 1, j, '#8f8468'); px(6, x + 20, j, '#8f8468') }
  for (let l = 0; l < 3; l++) for (let i = x + 3; i < x + 16; i++) px(6, i, y + 2 + l * 2 - (k % 2 ? 1 : 0), '#a39878')
}
// 7: livro em pé, encostado (visto de frente)
{
  const c = 7
  fill(c, 10, 3, 12, 17, COVERS[0], 80, 0.06)
  fill(c, 10, 3, 3, 17, shade(COVERS[0], 0.65), 81)
  fill(c, 13, 6, 8, 2, '#d8b45a', 82, 0.02); fill(c, 14, 10, 6, 1, '#d8b45a', 83, 0.02)
  for (let x = 10; x < 22; x++) { px(c, x, 2, OUT); px(c, x, 20, OUT) }
  for (let y = 2; y < 21; y++) { px(c, 9, y, OUT); px(c, 22, y, OUT) }
  fill(c, 3, 8, 7, 12, COVERS[1], 84, 0.06)
  for (let y = 8; y < 20; y++) px(c, 2, y, OUT)
  for (let x = 3; x < 10; x++) px(c, x, 7, OUT)
}

const BOOK_IDS = ['books@2,4', 'books@33,0', 'books@66,6', 'books@98,6', 'books@130,6', 'books@161,0', 'books@195,5', 'books@226,2']
const dir = 'assets-src/packs/livros'
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, 'books.png'), PNG.sync.write(png))
const labels = ['Três livros empilhados', 'Pilha alta de livros', 'Livro aberto', 'Dois livros deitados', 'Pergaminhos', 'Pilha bagunçada de livros', 'Folhas soltas empilhadas', 'Livro em pé']
const manifest = {
  name: 'Livros soltos (arte original do Vortable)',
  license: 'CC0 1.0 (arte própria, gerada por scripts/make-books.mjs)',
  source: 'https://github.com/bentonetofr/vortable',
  sheets: [{
    id: 'books', file: 'books.png', mode: 'pieces', kind: 'stand', category: 'Livros', label: 'Livros', tags: ['livro', 'biblioteca', 'pergaminho', 'papel'],
    collision: 'none',
    pieces: labels.map((_, i) => ({ x: i * CW, y: 0, w: CW, h: CH })),
  }],
  // os ids vêm do recorte no opaco de cada peça (x,y da 1ª posição com arte)
  objects: Object.fromEntries(labels.map((label, i) => [BOOK_IDS[i], { label }])),
}
fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(manifest, null, 2) + '\n')
fs.writeFileSync(path.join(dir, 'CREDITS.txt'), 'Livros soltos: arte original gerada por scripts/make-books.mjs do Vortable.\nLicença: CC0 1.0 (domínio público).\n')
console.log('ok')
