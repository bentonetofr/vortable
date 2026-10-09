// ────────────────────────────────────────────────────────
// Ampliação de pixel art sem borrar nem serrilhar: Scale2x (EPX) aplicado
// algumas vezes. Pixels vizinhos de mesma cor se ligam em diagonal, então as
// bordas ficam suaves, e os detalhes de 1 px (olho, cicatriz) continuam lá.
// Usado na prévia grande do criador de personagem.
// ────────────────────────────────────────────────────────

/** Uma passada de Scale2x: devolve uma imagem com o dobro do tamanho. */
function pass(src: Uint32Array, w: number, h: number): Uint32Array {
  const out = new Uint32Array(w * 2 * h * 2)
  const ow = w * 2
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : y) * w
    const down = (y < h - 1 ? y + 1 : y) * w
    const row = y * w
    for (let x = 0; x < w; x++) {
      const l = x > 0 ? x - 1 : x
      const r = x < w - 1 ? x + 1 : x
      const p = src[row + x]
      const a = src[up + x]
      const d = src[down + x]
      const c = src[row + l]
      const b = src[row + r]
      let e0 = p, e1 = p, e2 = p, e3 = p
      if (c !== d && a !== b) {
        if (c === a) e0 = a
        if (a === b) e1 = b
        if (d === c) e2 = c
        if (b === d) e3 = d
      }
      const o = y * 2 * ow + x * 2
      out[o] = e0
      out[o + 1] = e1
      out[o + ow] = e2
      out[o + ow + 1] = e3
    }
  }
  return out
}

/** Amplia um canvas `passes` vezes (cada uma dobra o tamanho: 3 passadas = 8×). */
export function scale2x(src: CanvasImageSource & { width: number; height: number }, passes: number): HTMLCanvasElement {
  let w = src.width
  let h = src.height
  const first = document.createElement('canvas')
  first.width = w
  first.height = h
  const fctx = first.getContext('2d', { willReadFrequently: true })!
  fctx.drawImage(src, 0, 0)
  const raw = fctx.getImageData(0, 0, w, h)
  let px: Uint32Array = new Uint32Array(raw.data.buffer.slice(0))
  // pixels transparentes são todos iguais entre si (a cor escondida não conta)
  for (let i = 0; i < px.length; i++) if ((px[i] >>> 24) === 0) px[i] = 0
  for (let i = 0; i < passes; i++) {
    px = pass(px, w, h)
    w *= 2
    h *= 2
  }
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const img = new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer), w, h)
  out.getContext('2d')!.putImageData(img, 0, 0)
  return out
}
