// ────────────────────────────────────────────────────────
// Tela de carregando do Vortable: o cavaleiro correndo em volta de um círculo, em looping,
// no lugar do texto "Carregando…" (a mesma animação do site, em DOM puro).
// ────────────────────────────────────────────────────────

import { h, injectStyle } from './dom'

const CSS = `
.vt-loader { --vt-loader-size: 128px; position: relative; flex: none; width: var(--vt-loader-size); height: var(--vt-loader-size); }
.vt-loader--sm { --vt-loader-size: 84px; }
.vt-loader::before { content: ''; position: absolute; inset: 19%; border-radius: 50%; border: 2px dashed rgba(240, 180, 90, 0.4); }
.vt-loader__run {
  position: absolute; left: 0; top: 0; width: 38%; aspect-ratio: 246 / 240;
  offset-path: circle(31% at 50% 50%); offset-rotate: 0deg;
  animation: vt-loader-orbit 1.9s linear infinite;
}
.vt-loader__knight {
  display: block; width: 100%; height: 100%;
  background: var(--vt-loader-img) center / contain no-repeat;
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.55));
  transform-origin: 50% 100%;
  animation: vt-loader-trot 0.32s ease-in-out infinite;
}
@keyframes vt-loader-orbit {
  0% { offset-distance: 0%; transform: scaleX(1); }
  48% { transform: scaleX(1); }
  52% { transform: scaleX(-1); }
  98% { transform: scaleX(-1); }
  100% { offset-distance: 100%; transform: scaleX(1); }
}
@keyframes vt-loader-trot {
  0%, 100% { transform: translateY(0) rotate(-6deg); }
  50% { transform: translateY(-10%) rotate(6deg); }
}
/* por cima do palco enquanto carrega */
.vt-loader-cover { position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center; background: #07080c; }
@media (prefers-reduced-motion: reduce) {
  .vt-loader__run { animation-duration: 3.8s; }
  .vt-loader__knight { animation: none; }
}
`

/** O cavaleiro correndo (`small` = menor). `assetBase` é a pasta de assets do Vortable. */
export function loaderEl(assetBase: string, small = false) {
  injectStyle('loader', CSS)
  const el = h('div', { class: `vt-loader${small ? ' vt-loader--sm' : ''}`, role: 'status', 'aria-label': 'Carregando' },
    h('span', { class: 'vt-loader__run' }, h('i', { class: 'vt-loader__knight' })),
  )
  el.style.setProperty('--vt-loader-img', `url("${assetBase}cavaleiro-loading.png")`)
  return el
}

/** O cavaleiro no meio do palco, cobrindo tudo (tira com `.remove()`). */
export function loaderCover(assetBase: string) {
  return h('div', { class: 'vt-loader-cover' }, loaderEl(assetBase))
}
