// Tela de créditos da arte. As licenças do LPC (CC-BY-SA / GPL / OGA-BY)
// exigem que os autores sejam creditados onde a arte aparece.

import { h } from './dom'
import { CATALOG_URL, objectCatalog, type ObjectCatalog, type PackInfo } from '../assets/objects'

const FIXED = [
  { title: 'Personagens', file: 'credits/CREDITS-character.md' },
  { title: 'Terrenos e interiores', file: 'credits/CREDITS-terrain.txt' },
]

/** Conteúdo da janela de créditos (carrega os textos na hora). */
export function creditsBody(assetBase: string): Node[] {
  const intro = h('p', { class: 'vt-credits-intro' },
    'A arte do Vortable vem do projeto Liberated Pixel Cup (LPC) e de artistas que a publicaram com licenças livres ',
    '(CC-BY-SA 3.0, GPL 3.0, OGA-BY e outras indicadas abaixo). Obrigado a todos.',
  )
  const section = ({ title, file }: { title: string; file: string }) => {
    const pre = h('pre', { class: 'vt-credits-text' }, 'Carregando...')
    fetch(assetBase + file)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => { pre.textContent = t.trim() })
      .catch(() => { pre.textContent = `Não deu pra carregar ${file}.` })
    return h('details', { class: 'vt-credits' }, h('summary', {}, title), pre)
  }
  // um bloco por pacote de objetos (o catálogo diz quais existem; fora do
  // jogo, como no criador de personagem, ele ainda não foi carregado)
  const packsEl = h('div')
  const addPacks = (packs: PackInfo[]) => packsEl.append(...packs.map((p) => section({ title: `Objetos: ${p.name}`, file: p.credits })))
  if (objectCatalog().packs.length) addPacks(objectCatalog().packs)
  else {
    fetch(assetBase + CATALOG_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((c: ObjectCatalog) => addPacks(c.packs ?? []))
      .catch(() => packsEl.append(h('p', { class: 'vt-credits-intro' }, 'Não deu pra carregar a lista de pacotes de objetos.')))
  }
  return [intro, ...FIXED.map(section), packsEl]
}
