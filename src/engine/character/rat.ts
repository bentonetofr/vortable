// ────────────────────────────────────────────────────────
// O rato do mestre (a transformação do NPC controlado): um ratinho azul, gordinho e fofo,
// desenhado em pixel art na hora (sem arquivo de imagem), pequeno perto de um boneco
// (uns 20 px de comprimento contra ~40 px de altura de uma pessoa). Sai nas mesmas folhas
// do boneco (parado, andando, correndo; cima, esquerda, baixo, direita), então o jogo o
// trata como qualquer outro personagem.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { ANIMS, FRAME, isBuilt, markBuilt, registerSheets, type AnimName } from './compose'

export const RAT_KEY = 'char:rat'

const OUT = '#22305f'
const BLUE = '#6f9de8'
const SHADE = '#4d78c8'
const LIGHT = '#b4cdf7'
const PINK = '#f2a7c0'
const NOSE = '#ff7fa6'
const EYE = '#12162b'
const WHITE = '#ffffff'

type Ctx = CanvasRenderingContext2D

function px(c: Ctx, x: number, y: number, color: string, w = 1, h = 1) {
  c.fillStyle = color
  c.fillRect(Math.round(x), Math.round(y), w, h)
}

/** Elipse de pixels, com contorno escuro opcional (mais larga em 1 px). */
function ell(c: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, line?: string) {
  const fill = (a: number, b: number, col: string) => {
    c.fillStyle = col
    for (let y = Math.floor(cy - b - 1); y <= Math.ceil(cy + b + 1); y++) {
      for (let x = Math.floor(cx - a - 1); x <= Math.ceil(cx + a + 1); x++) {
        if (((x + 0.5 - cx) / a) ** 2 + ((y + 0.5 - cy) / b) ** 2 <= 1) c.fillRect(x, y, 1, 1)
      }
    }
  }
  if (line) fill(rx + 1, ry + 1, line)
  fill(rx, ry, color)
}

interface Pose {
  /** Sobe e desce do corpo (px). */
  bob: number
  /** Passo: -1 a 1. */
  step: number
  /** Balanço do rabo: -1 a 1. */
  wag: number
}

/** De lado, virado pra direita (a esquerda é o espelho). */
function side(c: Ctx, p: Pose) {
  const by = 57.5 - p.bob
  // rabo rosa, comprido, enrolando pra cima
  for (let i = 0; i <= 10; i++) {
    const t = i / 10
    px(c, 26 - i * 0.95, by + 1.2 - Math.sin(t * Math.PI * 0.95) * (3 + p.wag), PINK)
    if (i < 4) px(c, 26 - i * 0.95, by + 2.2 - Math.sin(t * Math.PI * 0.95) * (3 + p.wag), PINK)
  }
  const lift = (k: number) => Math.max(0, k) * 1.2
  ell(c, 28 + p.step * 1.8, 60 - lift(-p.step), 1.6, 1.1, SHADE, OUT)
  ell(c, 31, by, 5.6, 3.7, BLUE, OUT)
  ell(c, 31.5, by + 1.9, 3.7, 1.4, LIGHT)
  ell(c, 34.5 - p.step * 1.8, 60 - lift(p.step), 1.6, 1.1, PINK, OUT)
  ell(c, 36, by - 0.7, 3.4, 3.1, BLUE, OUT)
  ell(c, 34.4, by - 3.7, 1.8, 1.8, BLUE, OUT)
  ell(c, 34.4, by - 3.6, 0.9, 0.9, PINK)
  px(c, 39.2, by - 0.8, NOSE, 1, 2)
  px(c, 37, by - 1.8, EYE, 1, 2)
  px(c, 37, by - 1.8, WHITE)
  // bigodes
  px(c, 40, by - 0.2, OUT)
  px(c, 41, by - 1.2, OUT)
  px(c, 41, by + 0.8, OUT)
}

/** De frente (o rosto pra quem olha). */
function front(c: Ctx, p: Pose) {
  const by = 57.5 - p.bob
  ell(c, 29.6, 60 - Math.max(0, p.step) * 1.2, 1.5, 1, PINK, OUT)
  ell(c, 34.4, 60 - Math.max(0, -p.step) * 1.2, 1.5, 1, PINK, OUT)
  ell(c, 32, by, 5.1, 3.7, BLUE, OUT)
  ell(c, 32, by + 1.5, 2.8, 1.3, LIGHT)
  ell(c, 28.6, by - 5.4, 1.9, 1.9, BLUE, OUT)
  ell(c, 35.4, by - 5.4, 1.9, 1.9, BLUE, OUT)
  ell(c, 28.6, by - 5.3, 0.95, 0.95, PINK)
  ell(c, 35.4, by - 5.3, 0.95, 0.95, PINK)
  ell(c, 32, by - 2.6, 4.2, 3.4, BLUE, OUT)
  px(c, 29.8, by - 3.6, EYE, 1, 2)
  px(c, 34.2, by - 3.6, EYE, 1, 2)
  px(c, 29.8, by - 3.6, WHITE)
  px(c, 34.2, by - 3.6, WHITE)
  px(c, 31, by - 1.4, NOSE, 2, 1)
  px(c, 27.4, by - 1.6, OUT)
  px(c, 36.6, by - 1.6, OUT)
}

/** De costas (o rabinho aparece embaixo). */
function back(c: Ctx, p: Pose) {
  const by = 57.5 - p.bob
  ell(c, 29.6, 60 - Math.max(0, p.step) * 1.2, 1.5, 1, PINK, OUT)
  ell(c, 34.4, 60 - Math.max(0, -p.step) * 1.2, 1.5, 1, PINK, OUT)
  // rabo
  for (let i = 0; i < 4; i++) px(c, 32 + Math.sin(i * 0.9 + 1) * (0.8 + p.wag * 0.6), by + 3.2 + i, PINK)
  ell(c, 32, by, 5.1, 3.7, BLUE, OUT)
  ell(c, 28.6, by - 5.4, 1.9, 1.9, BLUE, OUT)
  ell(c, 35.4, by - 5.4, 1.9, 1.9, BLUE, OUT)
  ell(c, 28.6, by - 5.3, 0.95, 0.95, SHADE)
  ell(c, 35.4, by - 5.3, 0.95, 0.95, SHADE)
  ell(c, 32, by - 2.6, 4.2, 3.4, BLUE, OUT)
  ell(c, 32, by + 0.4, 2.6, 1.2, SHADE)
}

/** As folhas do rato (parado, andando, correndo), no mesmo formato das do boneco. */
export function composeRat(): Record<AnimName, HTMLCanvasElement> {
  const out = {} as Record<AnimName, HTMLCanvasElement>
  for (const anim of Object.keys(ANIMS) as AnimName[]) {
    const { frames } = ANIMS[anim]
    const canvas = document.createElement('canvas')
    canvas.width = frames * FRAME
    canvas.height = 4 * FRAME
    const c = canvas.getContext('2d')!
    c.imageSmoothingEnabled = false
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < frames; col++) {
        // no andar, o quadro 0 é a pose parada; o ciclo é 1..8
        const moving = anim !== 'idle' && !(anim === 'walk' && col === 0)
        const phase = ((anim === 'walk' ? col - 1 : col) / 8) * Math.PI * 2
        const run = anim === 'run' ? 1.4 : 1
        const pose: Pose = moving
          ? { bob: Math.abs(Math.sin(phase)) * 0.9 * run, step: Math.sin(phase) * run, wag: Math.sin(phase * 2) }
          : { bob: anim === 'idle' ? (col ? 0.5 : 0) : 0, step: 0, wag: anim === 'idle' ? (col ? 0.8 : -0.4) : 0 }
        c.save()
        c.translate(col * FRAME, row * FRAME)
        // linhas do LPC: 0 cima, 1 esquerda, 2 baixo, 3 direita
        if (row === 1) { c.translate(FRAME, 0); c.scale(-1, 1); side(c, pose) }
        else if (row === 3) side(c, pose)
        else if (row === 2) front(c, pose)
        else back(c, pose)
        c.restore()
      }
    }
    out[anim] = canvas
  }
  return out
}

/** Põe o rato na cena com a chave dada (uma vez só por cena). */
export function buildRat(scene: Phaser.Scene, key = RAT_KEY) {
  if (isBuilt(scene, key, 'rato')) return
  registerSheets(scene, key, composeRat())
  markBuilt(scene, key, 'rato')
}
