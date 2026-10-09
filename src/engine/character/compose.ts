// ────────────────────────────────────────────────────────
// Monta o boneco: pega as camadas de cada item escolhido (corpo, cabeça,
// roupa, cabelo...), troca as cores de cada canal pela cor escolhida e
// empilha tudo (pela ordem zPos do LPC) numa folha só por animação.
// O jogo desenha 1 sprite por boneco, não 15.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { layerDir, loadCharacterData, type CharItem, type CharacterData } from './catalog'
import { PROC_DEFS, paintProc, type ProcDef } from './proc'
import type { Appearance, AppearanceItem, Dir } from '../types'

export const FRAME = 64
export const DIR_ROWS: Dir[] = ['up', 'left', 'down', 'right']

/** Animações LPC: quadros por linha; linhas sempre up, left, down, right. */
export const ANIMS = {
  walk: { frames: 9, rate: 10 },
  run: { frames: 8, rate: 12 },
  idle: { frames: 2, rate: 2 },
} as const
export type AnimName = keyof typeof ANIMS

const imageCache = new Map<string, Promise<HTMLImageElement>>()

function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => {
        imageCache.delete(url) // deixa tentar de novo depois
        reject(new Error(`não carregou ${url}`))
      }
      img.src = url
    })
    imageCache.set(url, p)
  }
  return p
}

function hexToRgb(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

/** Mapa cor-original → cor-nova de todos os canais de um item escolhido. */
function colorMap(data: CharacterData, item: CharItem, chosen: AppearanceItem, skin: string) {
  const map = new Map<number, number>()
  for (const ch of item.colors ?? []) {
    // canal de pele: segue o corpo (itens "matchBody") ou quando não escolheram outra cor
    const picked = chosen.colors?.[ch.key]
    const name = ch.material === 'body' && (item.matchBody || !picked) ? skin : picked
    const target = name ? data.palettes[ch.material]?.[name] : undefined
    if (!target) continue
    ch.source.forEach((c, i) => {
      const to = target[Math.min(i, target.length - 1)]
      if (to) map.set(hexToRgb(c), hexToRgb(to))
    })
  }
  return map
}

function recolor(canvas: HTMLCanvasElement, map: Map<number, number>) {
  if (!map.size) return
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const swap = map.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
    if (swap !== undefined) {
      d[i] = swap >> 16
      d[i + 1] = (swap >> 8) & 0xff
      d[i + 2] = swap & 0xff
    }
  }
  ctx.putImageData(img, 0, 0)
}

/**
 * Item sem a animação pedida: monta a partir da "walk" (parado = quadro 0
 * de cada direção; correndo = os 8 quadros do passo).
 */
function fromWalk(walk: HTMLImageElement, anim: AnimName) {
  const { frames } = ANIMS[anim]
  const c = document.createElement('canvas')
  c.width = frames * FRAME
  c.height = 4 * FRAME
  const ctx = c.getContext('2d')!
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < frames; col++) {
      const src = anim === 'idle' ? 0 : (col % 8) + 1
      ctx.drawImage(walk, src * FRAME, row * FRAME, FRAME, FRAME, col * FRAME, row * FRAME, FRAME, FRAME)
    }
  }
  return c
}

interface PlacedLayer {
  z: number
  order: number
  url: string
  fallback: boolean
  map: Map<number, number>
  /** Espaço do personagem que gerou a camada. */
  slot: string
  /** Peça desenhada por código: pinta no rosto em vez de carregar imagem. */
  proc?: { def: ProcDef; color?: string }
}

/** Todas as camadas da aparência, em ordem de desenho. */
function layersOf(data: CharacterData, assetBase: string, a: Appearance, anim: AnimName, only?: string): PlacedLayer[] {
  const out: PlacedLayer[] = []
  let order = 0
  for (const [slot, chosen] of Object.entries(a.slots)) {
    if (only && slot !== only) continue
    const item = data.byId.get(chosen.id)
    if (!item) continue
    if (item.proc) {
      const def = PROC_DEFS.get(item.id)
      if (def) out.push({ z: def.z ?? 102, order: order++, url: '', fallback: false, map: new Map(), slot, proc: { def, color: chosen.colors?.color } })
      continue
    }
    const has = item.anims.includes(anim)
    const file = has ? anim : 'walk'
    const map = colorMap(data, item, chosen, a.skin)
    for (const layer of item.layers) {
      const dir = layerDir(layer, a.body)
      const rel = chosen.variant ? `${dir}${file}/${chosen.variant}.png` : `${dir}${file}.png`
      out.push({ z: layer.z, order: order++, url: assetBase + data.catalog.sheets + rel, fallback: !has, map, slot })
    }
  }
  return out.sort((x, y) => x.z - y.z || x.order - y.order)
}

/** Folha de uma animação com a aparência inteira (ou só de um espaço, pras miniaturas). */
export async function composeAnim(assetBase: string, a: Appearance, anim: AnimName, only?: string) {
  const data = await loadCharacterData(assetBase)
  const { frames } = ANIMS[anim]
  const out = document.createElement('canvas')
  out.width = frames * FRAME
  out.height = 4 * FRAME
  const octx = out.getContext('2d')!

  const layers = layersOf(data, assetBase, a, anim, only)
  const images = await Promise.all(layers.map((l) => (l.proc ? null : loadImage(l.url).catch((err) => {
    console.warn('[vortable] camada do boneco não carregou:', err.message)
    return null
  }))))
  // a cabeça (já na cor da pele) serve de máscara pras marcas do rosto
  let headData: ImageData | null = null
  layers.forEach((l, i) => {
    if (l.proc) {
      if (!headData) return
      for (let row = 0; row < 4; row++) for (let col = 0; col < frames; col++) paintProc(octx, col * FRAME, row * FRAME, headData, col * FRAME, row * FRAME, row, l.proc.def, l.proc.color)
      return
    }
    const img = images[i]
    if (!img) return
    const sheet = document.createElement('canvas')
    sheet.width = out.width
    sheet.height = out.height
    const src = l.fallback ? fromWalk(img, anim) : img
    sheet.getContext('2d', { willReadFrequently: true })!.drawImage(src, 0, 0)
    recolor(sheet, l.map)
    octx.drawImage(sheet, 0, 0)
    if (l.slot === 'head') headData = sheet.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, sheet.width, sheet.height)
  })
  return out
}

/**
 * Um quadro só (64×64) da "walk", pra miniaturas: rápido porque recolore
 * só o quadro. Passe uma aparência com só os espaços que quer ver.
 */
export async function composeFrame(assetBase: string, a: Appearance, row = 2, col = 0) {
  const data = await loadCharacterData(assetBase)
  const out = document.createElement('canvas')
  out.width = out.height = FRAME
  const octx = out.getContext('2d')!
  const layers = layersOf(data, assetBase, a, 'walk')
  const images = await Promise.all(layers.map((l) => (l.proc ? null : loadImage(l.url).catch(() => null))))
  let headTile: ImageData | null = null
  layers.forEach((l, i) => {
    if (l.proc) {
      if (headTile) paintProc(octx, 0, 0, headTile, 0, 0, row, l.proc.def, l.proc.color)
      return
    }
    const img = images[i]
    if (!img) return
    const tile = document.createElement('canvas')
    tile.width = tile.height = FRAME
    const tctx = tile.getContext('2d', { willReadFrequently: true })!
    tctx.drawImage(img, col * FRAME, row * FRAME, FRAME, FRAME, 0, 0, FRAME, FRAME)
    recolor(tile, l.map)
    octx.drawImage(tile, 0, 0)
    if (l.slot === 'head') headTile = tctx.getImageData(0, 0, FRAME, FRAME)
  })
  return out
}

/** As três animações (prévia do criador e textura do jogo). */
export async function composeAll(assetBase: string, a: Appearance) {
  const names = Object.keys(ANIMS) as AnimName[]
  const canvases = await Promise.all(names.map((n) => composeAnim(assetBase, a, n)))
  return Object.fromEntries(names.map((n, i) => [n, canvases[i]])) as Record<AnimName, HTMLCanvasElement>
}

/** Qual aparência cada chave já tem montada (trocar de zona não remonta o boneco). */
const built = new WeakMap<Phaser.Textures.TextureManager, Map<string, string>>()

/**
 * Gera (ou regera) as texturas e animações de um boneco no Phaser.
 * Texturas: `${key}:walk`, `${key}:idle`...  Animações: `${key}:walk:down`...
 */
export async function buildCharacter(scene: Phaser.Scene, key: string, assetBase: string, appearance: Appearance) {
  const sig = JSON.stringify(appearance)
  let cache = built.get(scene.textures)
  if (!cache) built.set(scene.textures, (cache = new Map()))
  if (cache.get(key) === sig && scene.textures.exists(`${key}:walk`)) return

  registerSheets(scene, key, await composeAll(assetBase, appearance))
  cache.set(key, sig)
}

/** A chave já está montada com esta assinatura? (o rato usa 'rato' no lugar da aparência) */
export function isBuilt(scene: Phaser.Scene, key: string, sig: string) {
  return built.get(scene.textures)?.get(key) === sig && scene.textures.exists(`${key}:walk`)
}

/** Anota o que está montado em `key` (assim buildCharacter sabe quando precisa refazer). */
export function markBuilt(scene: Phaser.Scene, key: string, sig: string) {
  let cache = built.get(scene.textures)
  if (!cache) built.set(scene.textures, (cache = new Map()))
  cache.set(key, sig)
}

/** Põe as folhas (parado, andando, correndo) no Phaser como texturas e animações de `key`. */
export function registerSheets(scene: Phaser.Scene, key: string, sheets: Record<AnimName, HTMLCanvasElement>) {
  for (const anim of Object.keys(ANIMS) as AnimName[]) {
    const texKey = `${key}:${anim}`
    const { frames, rate } = ANIMS[anim]
    for (const dir of DIR_ROWS) scene.anims.remove(`${texKey}:${dir}`)
    if (scene.textures.exists(texKey)) scene.textures.remove(texKey)

    const tex = scene.textures.addCanvas(texKey, sheets[anim])!
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < frames; col++) tex.add(row * frames + col, 0, col * FRAME, row * FRAME, FRAME, FRAME)
    }
    DIR_ROWS.forEach((dir, row) => {
      // no walk o quadro 0 é a pose parada; o ciclo é 1..8
      const start = anim === 'walk' ? 1 : 0
      scene.anims.create({
        key: `${texKey}:${dir}`,
        frames: Array.from({ length: frames - start }, (_, c) => ({ key: texKey, frame: row * frames + start + c })),
        frameRate: rate,
        repeat: -1,
      })
    })
  }
}
