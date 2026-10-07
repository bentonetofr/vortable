// ────────────────────────────────────────────────────────
// Curadoria de uma peça do catálogo (só no desenvolvimento): nome,
// categoria, tags, tipo, colisão (retângulos desenhados por cima da
// arte), linha do pé e luz. O resultado vai pro pack.json do pacote.
// ────────────────────────────────────────────────────────

import { h } from '../ui/dom'
import { KIND_LABELS, variantsOf, type ObjectDef, type ObjectKind, type ObjectLight, type Rect } from '../assets/objects'

/** O ajuste gravado no pack.json (sem solids/sort = colisão automática). */
export interface CurateOverride {
  label: string
  category: string
  tags: string[]
  kind: ObjectKind
  solids?: Rect[]
  sort?: number
  light: ObjectLight | null
  fps?: number
  hidden?: boolean
}

type Mode = 'solid' | 'sort' | 'light'

const DEFAULT_LIGHT: ObjectLight = { x: 0, y: -24, radius: 96, color: '#ffb060', intensity: 1, flicker: 0.2 }

export function curateForm(def: ObjectDef, image: CanvasImageSource, categories: string[]) {
  let solids: Rect[] = structuredClone(def.solids)
  let sort = def.sort
  let auto = false
  let light: ObjectLight | null = def.light ? { ...def.light } : null
  let mode: Mode = 'solid'
  let selected = -1

  // ── Tela de desenho ─────────────────────────────────
  const scale = Math.max(1, Math.min(6, Math.floor(Math.min(360 / def.w, 300 / def.h))))
  const pad = 12
  const canvas = h('canvas', { class: 'vt-curate-canvas', width: def.w * scale + pad * 2, height: def.h * scale + pad * 2 }) as HTMLCanvasElement
  const ctx = canvas.getContext('2d')!
  /** px da tela ↔ px relativos à base-centro. */
  const toScreen = (x: number, y: number) => ({ x: pad + (x + def.w / 2) * scale, y: pad + (def.h + y) * scale })
  const fromScreen = (sx: number, sy: number) => ({ x: Math.round((sx - pad) / scale - def.w / 2), y: Math.round((sy - pad) / scale - def.h) })

  const draw = () => {
    ctx.imageSmoothingEnabled = false
    for (let y = 0; y < canvas.height; y += 8)
      for (let x = 0; x < canvas.width; x += 8) {
        ctx.fillStyle = ((x + y) / 8) % 2 ? '#20283a' : '#181f2e'
        ctx.fillRect(x, y, 8, 8)
      }
    ctx.drawImage(image, def.x, def.y, def.w, def.h, pad, pad, def.w * scale, def.h * scale)
    // base (onde o objeto encosta no chão)
    const base = toScreen(0, 0)
    ctx.fillStyle = '#ffc174'
    ctx.fillRect(base.x - 3, base.y - 1, 7, 3)
    solids.forEach((r, i) => {
      const a = toScreen(r.x, r.y)
      ctx.fillStyle = i === selected ? 'rgba(255,193,116,0.45)' : 'rgba(239,68,68,0.4)'
      ctx.fillRect(a.x, a.y, r.w * scale, r.h * scale)
      ctx.strokeStyle = i === selected ? '#ffc174' : '#ef4444'
      ctx.lineWidth = 2
      ctx.strokeRect(a.x + 1, a.y + 1, r.w * scale - 2, r.h * scale - 2)
    })
    const line = toScreen(0, -sort)
    ctx.strokeStyle = '#facc15'
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(pad, line.y)
    ctx.lineTo(canvas.width - pad, line.y)
    ctx.stroke()
    ctx.setLineDash([])
    if (light) {
      const c = toScreen(light.x, light.y)
      ctx.strokeStyle = light.color
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(c.x, c.y, light.radius * scale, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = light.color
      ctx.beginPath()
      ctx.arc(c.x, c.y, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  let drag: { x0: number; y0: number } | null = null
  const point = (e: PointerEvent) => {
    const b = canvas.getBoundingClientRect()
    return fromScreen(((e.clientX - b.left) * canvas.width) / b.width, ((e.clientY - b.top) * canvas.height) / b.height)
  }
  const rectAt = (p: { x: number; y: number }) =>
    solids.findIndex((r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h)
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  canvas.addEventListener('pointerdown', (e) => {
    const p = point(e)
    if (mode === 'sort') {
      sort = Math.max(0, -p.y)
      auto = false
    } else if (mode === 'light') {
      light = { ...(light ?? DEFAULT_LIGHT), x: p.x, y: p.y }
      syncLight()
    } else {
      const hit = rectAt(p)
      if (e.button === 2) {
        // botão direito apaga o retângulo
        if (hit >= 0) solids.splice(hit, 1)
        selected = -1
        auto = false
      } else if (hit >= 0) {
        selected = hit
      } else {
        drag = p ? { x0: p.x, y0: p.y } : null
        selected = -1
        canvas.setPointerCapture(e.pointerId)
      }
    }
    syncInputs()
    draw()
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return
    draw()
    const p = point(e)
    const a = toScreen(Math.min(drag.x0, p.x), Math.min(drag.y0, p.y))
    ctx.strokeStyle = '#ffc174'
    ctx.strokeRect(a.x, a.y, Math.abs(p.x - drag.x0) * scale, Math.abs(p.y - drag.y0) * scale)
  })
  canvas.addEventListener('pointerup', (e) => {
    if (!drag) return
    const p = point(e)
    const r = { x: Math.min(drag.x0, p.x), y: Math.min(drag.y0, p.y), w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0) }
    drag = null
    if (r.w >= 2 && r.h >= 2) {
      solids.push(r)
      selected = solids.length - 1
      auto = false
    }
    syncInputs()
    draw()
  })

  // ── Campos ──────────────────────────────────────────
  const field = (label: string, el: Node) => h('div', { class: 'vt-row' }, h('label', {}, label), el)
  const name = h('input', { class: 'vt-input', value: def.label }) as HTMLInputElement
  const listId = `vt-cats-${Math.random().toString(36).slice(2)}`
  const category = h('input', { class: 'vt-input', value: def.category, list: listId }) as HTMLInputElement
  const datalist = h('datalist', { id: listId }, ...categories.map((c) => h('option', { value: c })))
  const tags = h('input', { class: 'vt-input', value: def.tags.join(', '), placeholder: 'madeira, interior, ...' }) as HTMLInputElement
  const kind = h('select', { class: 'vt-select' },
    ...(Object.keys(KIND_LABELS) as ObjectKind[]).map((k) => h('option', { value: k, selected: k === def.kind }, KIND_LABELS[k])),
  ) as HTMLSelectElement
  const sortInput = h('input', { class: 'vt-input vt-num', type: 'number', min: 0, value: sort, oninput: () => { sort = Math.max(0, Number(sortInput.value) || 0); auto = false; draw() } }) as HTMLInputElement
  const fps = def.anim ? h('input', { class: 'vt-input vt-num', type: 'number', min: 1, max: 30, value: def.anim.fps }) as HTMLInputElement : null
  const hidden = h('input', { type: 'checkbox' }) as HTMLInputElement
  const autoNote = h('small', { class: 'vt-note' })

  const lightOn = h('input', { type: 'checkbox', checked: !!light, onchange: () => { light = lightOn.checked ? { ...(light ?? DEFAULT_LIGHT) } : null; syncLight(); draw() } }) as HTMLInputElement
  const radius = h('input', { class: 'vt-input vt-num', type: 'number', min: 8, max: 512 }) as HTMLInputElement
  const color = h('input', { class: 'vt-color', type: 'color' }) as HTMLInputElement
  const intensity = h('input', { class: 'vt-input vt-num', type: 'number', min: 0.1, max: 2, step: 0.1 }) as HTMLInputElement
  const flicker = h('input', { class: 'vt-input vt-num', type: 'number', min: 0, max: 1, step: 0.05 }) as HTMLInputElement
  const lightFields = h('div', { class: 'vt-curate-light' },
    field('Raio', radius), field('Cor', color), field('Força', intensity), field('Tremor', flicker),
  )
  for (const el of [radius, color, intensity, flicker]) {
    el.addEventListener('input', () => {
      if (!light) return
      light = { ...light, radius: Number(radius.value) || light.radius, color: color.value, intensity: Number(intensity.value) || 0, flicker: Number(flicker.value) || 0 }
      draw()
    })
  }
  function syncLight() {
    lightOn.checked = !!light
    lightFields.hidden = !light
    if (!light) return
    radius.value = String(light.radius)
    color.value = light.color
    intensity.value = String(light.intensity)
    flicker.value = String(light.flicker)
  }
  function syncInputs() {
    sortInput.value = String(sort)
    autoNote.textContent = auto ? 'Colisão automática (calculada pela arte).' : ''
  }

  const modeBtns = new Map<Mode, HTMLButtonElement>()
  const modes = h('div', { class: 'vt-curate-modes' })
  for (const [m, label, tip] of [
    ['solid', 'Colisão', 'Arraste pra desenhar um retângulo · botão direito apaga'],
    ['sort', 'Linha do pé', 'Clique na altura do pé: quem passa acima dela fica atrás'],
    ['light', 'Luz', 'Clique onde a luz nasce'],
  ] as const) {
    const b = h('button', { class: 'vt-chip', title: tip, onclick: () => { mode = m; for (const [k, el] of modeBtns) el.classList.toggle('vt-on', k === m) } }, label)
    modeBtns.set(m, b)
    modes.append(b)
  }
  modeBtns.get('solid')!.classList.add('vt-on')

  const variants = variantsOf(def).length
  const body = [
    h('div', { class: 'vt-curate' },
      h('div', { class: 'vt-curate-art' },
        modes,
        canvas,
        h('div', { class: 'vt-row' },
          h('button', { class: 'vt-btn', onclick: () => { solids = []; selected = -1; auto = false; syncInputs(); draw() } }, 'Sem colisão'),
          h('button', { class: 'vt-btn', title: 'Volta a colisão e a linha do pé calculadas pela arte (vale ao salvar)', onclick: () => { auto = true; syncInputs() } }, 'Automática'),
        ),
        autoNote,
      ),
      h('div', { class: 'vt-curate-fields' },
        field('Nome', name),
        field('Categoria', category), datalist,
        field('Tags', tags),
        field('Tipo', kind),
        field('Linha do pé', h('span', { class: 'vt-row' }, sortInput, h('small', { class: 'vt-note' }, 'px acima da base'))),
        fps ? field('Quadros/s', fps) : null,
        h('label', { class: 'vt-check' }, lightOn, ' Emite luz'),
        lightFields,
        h('label', { class: 'vt-check' }, hidden, ' Esconder do catálogo (peça ruim ou repetida)'),
        h('small', { class: 'vt-note' }, `${def.id} · pacote ${def.pack}${variants > 1 ? ` · vale para as ${variants} variantes` : ''}`),
      ),
    ),
  ]
  syncLight()
  syncInputs()
  draw()

  return {
    body,
    value(): CurateOverride {
      const out: CurateOverride = {
        label: name.value.trim() || def.label,
        category: category.value.trim() || def.category,
        tags: tags.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
        kind: kind.value as ObjectKind,
        light,
      }
      if (!auto) {
        out.solids = solids
        out.sort = sort
      }
      if (fps) out.fps = Math.max(1, Math.min(30, Number(fps.value) || def.anim!.fps))
      if (hidden.checked) out.hidden = true
      return out
    },
  }
}
