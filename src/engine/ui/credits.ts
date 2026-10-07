// Tela de créditos da arte. As licenças do LPC (CC-BY-SA / GPL / OGA-BY)
// exigem que os autores sejam creditados onde a arte aparece.

import { h } from './dom'

const FILES = [
  { title: 'Personagens', file: 'credits/CREDITS-character.md' },
  { title: 'Terrenos e interiores', file: 'credits/CREDITS-terrain.txt' },
  { title: 'Árvores', file: 'credits/CREDITS-trees.txt' },
]

/** Conteúdo da janela de créditos (carrega os textos na hora). */
export function creditsBody(assetBase: string): Node[] {
  const intro = h('p', { class: 'vt-credits-intro' },
    'A arte do Vortable vem do projeto Liberated Pixel Cup (LPC) e de artistas que a publicaram com licenças livres ',
    '(CC-BY-SA 3.0, GPL 3.0, OGA-BY e outras indicadas abaixo). Obrigado a todos.',
  )
  const sections = FILES.map(({ title, file }) => {
    const pre = h('pre', { class: 'vt-credits-text' }, 'Carregando...')
    fetch(assetBase + file)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => { pre.textContent = t.trim() })
      .catch(() => { pre.textContent = `Não deu pra carregar ${file}.` })
    return h('details', { class: 'vt-credits' }, h('summary', {}, title), pre)
  })
  return [intro, ...sections]
}
