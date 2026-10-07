// Harness de desenvolvimento: roda o Vortable sozinho, sem o Vorterium.

import { mountVortable, paletteNames, type Appearance } from '../engine'
import { makeDemoZone } from './demoZone'

const assetBase = './assets/'

const appearance: Appearance = {
  layers: [
    { sheet: 'body',             palette: { material: 'body',  color: 'light' } },
    { sheet: 'head',             palette: { material: 'body',  color: 'light' } },
    { sheet: 'eyes',             palette: { material: 'eye',   color: 'brown' } },
    { sheet: 'feet_shoes',       palette: { material: 'cloth', color: 'brown' } },
    { sheet: 'legs_pants',       palette: { material: 'cloth', color: 'navy' } },
    { sheet: 'torso_longsleeve', palette: { material: 'cloth', color: 'forest' } },
    { sheet: 'hair_messy1',      palette: { material: 'hair',  color: 'chestnut' } },
  ],
}

const vortable = mountVortable(document.getElementById('app')!, { zone: makeDemoZone(), appearance, assetBase })

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]

async function randomAppearance(): Promise<Appearance> {
  const [skins, eyes, cloth, hair] = await Promise.all(
    ['body', 'eye', 'cloth', 'hair'].map((m) => paletteNames(assetBase, m)),
  )
  const skin = pick(skins)
  const colors: Record<string, { material: string; color: string }> = {
    body: { material: 'body', color: skin },
    head: { material: 'body', color: skin },
    eyes: { material: 'eye', color: pick(eyes) },
    feet_shoes: { material: 'cloth', color: pick(cloth) },
    legs_pants: { material: 'cloth', color: pick(cloth) },
    torso_longsleeve: { material: 'cloth', color: pick(cloth) },
    hair_messy1: { material: 'hair', color: pick(hair) },
  }
  return { layers: appearance.layers.map((l) => ({ sheet: l.sheet, palette: colors[l.sheet] })) }
}

window.addEventListener('keydown', async (e) => {
  if (e.key === 'r' || e.key === 'R') vortable.setAppearance(await randomAppearance())
})
