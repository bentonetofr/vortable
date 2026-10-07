// ────────────────────────────────────────────────────────
// Monta o boneco: pega as camadas LPC (corpo, cabeça, roupa, cabelo...),
// troca as cores de cada uma pela paleta escolhida e empilha tudo numa
// folha só por animação. O jogo desenha 1 sprite por boneco, não 10.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { ANIMS, FRAME, PALETTES, characterSheetById, type AnimName } from '../assets/catalog'
import type { Appearance, Dir } from '../types'

export const DIR_ROWS: Dir[] = ['up', 'left', 'down', 'right']

type Palettes = Record<string, Record<string, string[]>>

const imageCache = new Map<string, Promise<HTMLImageElement>>()
let palettesPromise: Promise<Palettes> | null = null

function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`não carregou ${url}`))
      img.src = url
    })
    imageCache.set(url, p)
  }
  return p
}

function loadPalettes(assetBase: string): Promise<Palettes> {
  palettesPromise ??= Promise.all(
    Object.entries(PALETTES).map(async ([material, def]) => {
      const res = await fetch(assetBase + def.url)
      return [material, (await res.json()) as Record<string, string[]>] as const
    }),
  ).then((entries) => Object.fromEntries(entries))
  return palettesPromise
}

export async function paletteNames(assetBase: string, material: string): Promise<string[]> {
  return Object.keys((await loadPalettes(assetBase))[material] ?? {})
}

function hexToRgb(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

/** Troca cada cor da paleta base pela cor de mesma posição na paleta escolhida. */
function recolor(ctx: CanvasRenderingContext2D, w: number, h: number, from: string[], to: string[]) {
  const map = new Map<number, number>()
  from.forEach((c, i) => to[i] && map.set(hexToRgb(c), hexToRgb(to[i])))
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const rgb = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]
    const swap = map.get(rgb)
    if (swap !== undefined) {
      d[i] = swap >> 16
      d[i + 1] = (swap >> 8) & 0xff
      d[i + 2] = swap & 0xff
    }
  }
  ctx.putImageData(img, 0, 0)
}

async function composeAnim(assetBase: string, appearance: Appearance, anim: AnimName, palettes: Palettes) {
  const { frames } = ANIMS[anim]
  const out = document.createElement('canvas')
  out.width = frames * FRAME
  out.height = 4 * FRAME
  const octx = out.getContext('2d')!

  const layers = appearance.layers
    .map((l) => ({ layer: l, def: characterSheetById.get(l.sheet) }))
    .filter((x) => x.def)
    .sort((a, b) => a.def!.z - b.def!.z)

  const images = await Promise.all(layers.map(({ def }) => loadImage(`${assetBase}${def!.dir}/${anim}.png`).catch(() => null)))

  layers.forEach(({ layer, def }, i) => {
    const img = images[i]
    if (!img) return
    const choice = layer.palette
    const material = choice?.material ?? def!.material
    const base = palettes[material]?.[PALETTES[material]?.base]
    const target = choice ? palettes[material]?.[choice.color] : undefined
    if (!base || !target || choice!.color === PALETTES[material].base) {
      octx.drawImage(img, 0, 0)
      return
    }
    const tmp = document.createElement('canvas')
    tmp.width = img.width
    tmp.height = img.height
    const tctx = tmp.getContext('2d', { willReadFrequently: true })!
    tctx.drawImage(img, 0, 0)
    recolor(tctx, tmp.width, tmp.height, base, target)
    octx.drawImage(tmp, 0, 0)
  })
  return out
}

/**
 * Gera (ou regera) as texturas e animações de um boneco no Phaser.
 * Texturas: `${key}:walk`, `${key}:idle`...  Animações: `${key}:walk:down`...
 */
export async function buildCharacter(scene: Phaser.Scene, key: string, assetBase: string, appearance: Appearance) {
  const palettes = await loadPalettes(assetBase)
  const names = Object.keys(ANIMS) as AnimName[]
  const canvases = await Promise.all(names.map((a) => composeAnim(assetBase, appearance, a, palettes)))

  names.forEach((anim, i) => {
    const texKey = `${key}:${anim}`
    const { frames, rate } = ANIMS[anim]
    for (const dir of DIR_ROWS) scene.anims.remove(`${texKey}:${dir}`)
    if (scene.textures.exists(texKey)) scene.textures.remove(texKey)

    const tex = scene.textures.addCanvas(texKey, canvases[i])!
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < frames; col++) {
        tex.add(row * frames + col, 0, col * FRAME, row * FRAME, FRAME, FRAME)
      }
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
  })
}
