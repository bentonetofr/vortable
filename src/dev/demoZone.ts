// Zona de teste do M0, gerada por código (no M1 ela sai do editor).

import { TILE, type ZoneData, type ZoneObject } from '../engine'
import { seeded } from '../engine/rng'

export function makeDemoZone(): ZoneData {
  const width = 50, height = 36
  const W = width + 1, H = height + 1
  const corners: string[] = new Array(W * H).fill('')
  const set = (x: number, y: number, t: string) => {
    if (x >= 0 && y >= 0 && x < W && y < H) corners[y * W + x] = t
  }

  // lago com margem de terra
  const pond = { x: 34, y: 11 }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot((x - pond.x) * 0.8, y - pond.y)
      if (d < 5.2) set(x, y, 'water')
      else if (d < 6.6) set(x, y, 'dirt')
    }
  }

  // trilha de terra serpenteando de leste a oeste, e uma descendo
  for (let x = 0; x < W; x++) {
    const cy = Math.round(22 + Math.sin(x / 6) * 2.5)
    for (let dy = -1; dy <= 1; dy++) set(x, cy + dy, corners[(cy + dy) * W + x] === 'water' ? 'water' : 'dirt')
  }
  for (let y = 22; y < H; y++) {
    const cx = Math.round(14 + Math.sin(y / 4) * 1.5)
    for (let dx = -1; dx <= 1; dx++) set(cx + dx, y, 'dirt')
  }

  const isOpen = (px: number, py: number, pad: number) => {
    const tx = Math.round(px / TILE), ty = Math.round(py / TILE)
    for (let y = ty - pad; y <= ty + pad; y++)
      for (let x = tx - pad; x <= tx + pad; x++)
        if (x >= 0 && y >= 0 && x < W && y < H && corners[y * W + x] !== '') return false
    return true
  }

  const rnd = seeded(7)
  const objects: ZoneObject[] = []
  const trees = ['tree-round', 'tree-tall', 'tree-old', 'tree-leafy', 'tree-pine', 'tree-big']
  const spawn = { x: 20 * TILE, y: 21 * TILE }
  const farFromSpawn = (x: number, y: number) => Math.hypot(x - spawn.x, y - spawn.y) > 4 * TILE
  const place = (kind: string, x: number, y: number) => objects.push({ kind, x: Math.round(x), y: Math.round(y) })

  // borda de floresta no topo e nas laterais
  for (let x = 0; x < width * TILE; x += 40 + rnd() * 30) place(trees[Math.floor(rnd() * trees.length)], x, 40 + rnd() * 50)
  for (let y = 120; y < height * TILE; y += 50 + rnd() * 30) {
    place(trees[Math.floor(rnd() * trees.length)], 10 + rnd() * 40, y)
    place(trees[Math.floor(rnd() * trees.length)], width * TILE - 10 - rnd() * 40, y)
  }
  // árvores e arbustos soltos
  for (let i = 0; i < 70; i++) {
    const x = 80 + rnd() * (width * TILE - 160)
    const y = 160 + rnd() * (height * TILE - 200)
    if (!isOpen(x, y, 2) || !farFromSpawn(x, y)) continue
    place(rnd() < 0.25 ? 'bush' : trees[Math.floor(rnd() * trees.length)], x, y)
  }

  return { version: 1, id: 'demo', name: 'Clareira de teste', width, height, base: 'grass', corners, objects, spawn }
}
