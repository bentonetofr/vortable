// Cabelos do Vortable montados a partir dos cabelos do LPC (derivados: mesma licença, CC-BY-SA / GPL):
//   node scripts/make-hair.mjs
// Cada receita sobrepõe, quadro a quadro, as folhas de cabelos existentes (todas têm o mesmo molde
// 64×64 e a mesma rampa de cores), grava as folhas novas em public/assets/character/sheets/hair/<pasta>/
// e acrescenta o item ao catalog.json (idempotente). Rode de novo depois de `build-character-catalog.mjs`.
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'

const ROOT = 'public/assets/character'
const HAIR = path.join(ROOT, 'sheets', 'hair')
const ANIMS = ['idle', 'walk', 'run']

/**
 * id do item, pasta, nome e as folhas que se somam (de baixo pra cima). Cada parte é o nome da pasta
 * ou { from, minY }: só os pixels da folha a partir da linha `minY` do quadro (as mechas que caem dos lados).
 */
// de frente caem inteiras; de lado só até a orelha; de costas não aparecem (cabelo curto atrás)
const STRANDS = { from: 'unkempt', minY: 21, maxYByRow: { 0: 0, 1: 30, 2: 99, 3: 30 } }
/** Cabelos que existiram em testes e foram descartados: saem do catálogo. */
const DROPPED = ['hair/short/hair_vt_desgrenhado2', 'hair/short/hair_vt_desgrenhado3']
const RECIPES = [
  { id: 'hair/short/hair_vt_desgrenhado', dir: 'vt_desgrenhado', name: 'Desgrenhado', parts: ['pixie', 'messy1', STRANDS] },
]

const read = (p) => PNG.sync.read(fs.readFileSync(p))
function over(dst, src) {
  for (let i = 0; i < dst.data.length; i += 4) {
    const a = src.data[i + 3]
    if (!a) continue
    if (a === 255 || !dst.data[i + 3]) { dst.data.set(src.data.subarray(i, i + 4), i); continue }
    const sa = a / 255, da = dst.data[i + 3] / 255, oa = sa + da * (1 - sa)
    for (let k = 0; k < 3; k++) dst.data[i + k] = Math.round((src.data[i + k] * sa + dst.data[i + k] * da * (1 - sa)) / oa)
    dst.data[i + 3] = Math.round(oa * 255)
  }
}

const catalogPath = path.join(ROOT, 'catalog.json')
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
catalog.items = catalog.items.filter((i) => !DROPPED.includes(i.id))
const model = catalog.items.find((i) => i.id === 'hair/short/hair_messy1') // mesma rampa de cores
if (!model) throw new Error('hair_messy1 não está no catálogo')

for (const r of RECIPES) {
  const out = path.join(HAIR, r.dir, 'adult')
  fs.mkdirSync(out, { recursive: true })
  for (const anim of ANIMS) {
    const sheets = r.parts.map((p) => {
      const part = typeof p === 'string' ? { from: p } : p
      const png = read(path.join(HAIR, part.from, 'adult', `${anim}.png`))
      if (part.minY !== undefined) {
        for (let y = 0; y < png.height; y++) {
          const row = Math.floor(y / 64) % 4, inFrame = y % 64
          if (inFrame < part.minY || inFrame > (part.maxYByRow?.[row] ?? 99)) for (let x = 0; x < png.width; x++) png.data[(y * png.width + x) * 4 + 3] = 0
        }
      }
      return png
    })
    const merged = new PNG({ width: sheets[0].width, height: sheets[0].height })
    merged.data.fill(0)
    for (const s of sheets) over(merged, s)
    fs.writeFileSync(path.join(out, `${anim}.png`), PNG.sync.write(merged))
  }
  const item = {
    ...structuredClone(model),
    id: r.id,
    name: r.name,
    layers: [{ z: 120, paths: { male: `hair/${r.dir}/adult/`, female: `hair/${r.dir}/adult/` } }],
  }
  catalog.items = catalog.items.filter((i) => i.id !== r.id)
  catalog.items.push(item)
}
fs.writeFileSync(catalogPath, JSON.stringify(catalog))
// créditos: os cabelos novos são derivados da arte do LPC (a licença exige manter autoria e licença)
const credits = 'public/assets/credits/CREDITS-character.md'
const marker = '## Cabelos montados pelo Vortable'
if (fs.existsSync(credits) && !fs.readFileSync(credits, 'utf8').includes(marker)) {
  fs.appendFileSync(credits, `
${marker}

Os cabelos "vt_*" (ex.: Desgrenhado) são combinações dos cabelos pixie, messy1 e unkempt do LPC,
feitas por scripts/make-hair.mjs. Obra derivada: mantém os autores e as licenças desses cabelos (CC-BY-SA 3.0 / GPL 3.0 / OGA-BY 3.0).
`)
}
console.log('cabelos:', RECIPES.map((r) => r.name).join(', '))
