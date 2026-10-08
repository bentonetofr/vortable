// Gera a arte das escadas de degraus (pacote "escadas", arte original do Vortable):
//   node scripts/make-stairs.mjs && node scripts/build-catalog.mjs --pack escadas
// Quatro peças de 96×64 (3 tiles de largura × 2 de altura), empilhadas numa folha:
//   0 pedra subindo · 1 pedra descendo · 2 madeira subindo · 3 madeira descendo
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'

const W = 96, H = 64, SPRITES = 4
const png = new PNG({ width: W, height: H * SPRITES })
png.data.fill(0)

const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
const noise = (x, y, s) => {
  let h = Math.imul(x + 1, 374761393) + Math.imul(y + 1, 668265263) + Math.imul(s, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function px(oy, x, y, rgb, a = 255) {
  if (x < 0 || x >= W || y < 0 || y >= H) return
  const i = ((oy + y) * W + x) * 4
  png.data[i] = rgb[0]; png.data[i + 1] = rgb[1]; png.data[i + 2] = rgb[2]; png.data[i + 3] = a
}
/** Retângulo com leve variação de tom (textura de pedra/madeira). */
function rect(oy, x0, y0, x1, y1, base, { grain = 0.06, seed = 1, wood = false } = {}) {
  const [r, g, b] = hex(base)
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    let k = (noise(x, y, seed) - 0.5) * 2 * grain
    if (wood) k += Math.sin((x * 0.9 + noise(0, Math.floor(y / 3), seed) * 8)) * 0.035 // veios horizontais
    px(oy, x, y, [Math.max(0, Math.min(255, r * (1 + k))), Math.max(0, Math.min(255, g * (1 + k))), Math.max(0, Math.min(255, b * (1 + k)))])
  }
}
const line = (oy, x0, x1, y, c) => { for (let x = x0; x < x1; x++) px(oy, x, y, hex(c)) }
const vline = (oy, x, y0, y1, c) => { for (let y = y0; y < y1; y++) px(oy, x, y, hex(c)) }
const darken = (c, f) => { const [r, g, b] = hex(c); return '#' + [r, g, b].map((v) => Math.round(v * f).toString(16).padStart(2, '0')).join('') }

const PALETTE = {
  stone: { tread: '#8e8274', edge: '#bcae9b', riser: '#4d453d', side: '#4a423a', cap: '#7d7366', out: '#211c18', deep: '#15120f', wood: false },
  wood: { tread: '#a37243', edge: '#c89a63', riser: '#6a4426', side: '#4b3019', cap: '#7c5532', out: '#241608', deep: '#1a1109', wood: true },
}

function up(oy, p, seed) {
  const STEP = 12
  rect(oy, 8, 0, W - 8, 4, darken(p.riser, 0.55), { seed, wood: p.wood })          // sombra do patamar lá no fundo
  for (let k = 0; k < 5; k++) {
    const yb = H - STEP * k                                                          // base do degrau k
    rect(oy, 8, yb - 7, W - 8, yb, p.riser, { seed: seed + k, wood: p.wood })        // espelho (a face da frente), bem mais escuro
    line(oy, 8, W - 8, yb - 1, darken(p.riser, 0.55))                                // sombra no pé do espelho
    line(oy, 8, W - 8, yb - 2, darken(p.riser, 0.75))
    rect(oy, 8, yb - 12, W - 8, yb - 7, p.tread, { seed: seed + 10 + k, wood: p.wood }) // piso do degrau
    line(oy, 8, W - 8, yb - 12, p.edge)                                              // quina de cima, mais clara
    line(oy, 8, W - 8, yb - 8, darken(p.tread, 1.1))                                 // quina da frente do piso
  }
  // laterais (muretas), com tampa clara
  for (const x0 of [0, W - 8]) {
    rect(oy, x0, 4, x0 + 8, H, p.side, { seed: seed + 50, wood: p.wood })
    rect(oy, x0, 4, x0 + 8, 9, p.cap, { seed: seed + 51, wood: p.wood })
    vline(oy, x0 === 0 ? 7 : W - 8, 9, H, darken(p.side, 0.6))
  }
  // contorno
  line(oy, 0, W, 3, p.out)
  vline(oy, 0, 4, H, p.out); vline(oy, W - 1, 4, H, p.out)
  line(oy, 0, W, H - 1, p.out)
}

function down(oy, p, seed) {
  // abertura escura com os degraus descendo (cada vez menores e mais escuros)
  rect(oy, 0, 0, W, H, p.side, { seed: seed + 3, wood: p.wood })
  rect(oy, 8, 6, W - 8, 50, p.deep, { grain: 0.02, seed })
  let y = 50
  const heights = [9, 8, 7, 6, 5, 4]
  heights.forEach((h, k) => {
    const shade = 1 - k * 0.14
    rect(oy, 8, y - h, W - 8, y, darken(p.tread, shade), { seed: seed + 20 + k, wood: p.wood })
    line(oy, 8, W - 8, y - h, darken(p.edge, shade))
    line(oy, 8, W - 8, y - 1, darken(p.riser, shade * 0.6))
    y -= h
  })
  // borda da frente (piso do andar) e quinas
  rect(oy, 0, 50, W, 56, p.cap, { seed: seed + 5, wood: p.wood })
  line(oy, 0, W, 50, p.edge)
  rect(oy, 0, 56, W, H, p.side, { seed: seed + 6, wood: p.wood })
  line(oy, 0, W, 56, darken(p.side, 0.6))
  // paredes de dentro da abertura
  for (const x0 of [0, W - 8]) {
    rect(oy, x0, 0, x0 + 8, 50, darken(p.side, 0.85), { seed: seed + 7, wood: p.wood })
    vline(oy, x0 === 0 ? 8 : W - 9, 6, 50, darken(p.side, 0.45))
  }
  rect(oy, 0, 0, W, 6, darken(p.side, 0.7), { seed: seed + 8, wood: p.wood })
  // contorno
  line(oy, 0, W, 0, p.out); line(oy, 0, W, H - 1, p.out)
  vline(oy, 0, 0, H, p.out); vline(oy, W - 1, 0, H, p.out)
}

up(0, PALETTE.stone, 11)
down(H, PALETTE.stone, 22)
up(H * 2, PALETTE.wood, 33)
down(H * 3, PALETTE.wood, 44)

const dir = 'assets-src/packs/escadas'
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, 'stairs.png'), PNG.sync.write(png))
const manifest = {
  name: 'Escadas de degraus (arte original do Vortable)',
  license: 'CC0 1.0 (arte própria, gerada por scripts/make-stairs.mjs)',
  source: 'https://github.com/bentonetofr/vortable',
  sheets: [{
    id: 'stairs', file: 'stairs.png', mode: 'pieces', kind: 'floor', category: 'Escadas', label: 'Escada', tags: ['escada', 'degraus', 'andar', 'castelo'],
    collision: 'none',
    pieces: [0, 1, 2, 3].map((i) => ({ x: 0, y: H * i, w: W, h: H })),
  }],
  objects: {
    'stairs@0,0': { label: 'Escada de pedra (subindo)' },
    'stairs@0,64': { label: 'Escada de pedra (descendo)' },
    'stairs@0,128': { label: 'Escada de madeira (subindo)' },
    'stairs@0,192': { label: 'Escada de madeira (descendo)' },
  },
}
fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(manifest, null, 2) + '\n')
fs.writeFileSync(path.join(dir, 'CREDITS.txt'), 'Escadas de degraus: arte original gerada por scripts/make-stairs.mjs do Vortable.\nLicença: CC0 1.0 (domínio público).\n')
console.log('ok')
