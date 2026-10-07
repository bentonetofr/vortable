// Ajudantes de DOM das interfaces do Vortable (sem React).

export type Children = (Node | string | null | undefined | false)[]

/** Cria um elemento: h('button', { class: 'x', onclick }, 'texto', outroNó). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'class') el.className = String(v)
    else if (k === 'html') el.innerHTML = String(v)
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c)
  return el
}

const injected = new Set<string>()

/** Põe uma folha de estilo na página uma vez só. */
export function injectStyle(id: string, css: string) {
  if (injected.has(id)) return
  injected.add(id)
  document.head.append(h('style', { 'data-vortable': id }, css))
}
