// pdfjs-dist 5.x client-side loader. The pdfjs module references browser-only
// APIs (DOMMatrix, OffscreenCanvas) that don't exist in Node, so it CANNOT be
// statically imported in Next.js — even on a 'use client' page, the server
// still evaluates the module graph during the prepass and crashes.
//
// We lazy-load pdfjs via dynamic import() the first time loadPdf() runs. Since
// loadPdf() is only called from event handlers / effects, it's always client-side.
//
// Worker is served from /public/pdf.worker.min.mjs — no bundler-specific worker
// URL magic needed. To update on pdfjs version bumps:
//   cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/

// Simple LRU cache to hold recent render promises/canvases so back/forward navigation
// and quick re-renders don't re-run expensive rasterization repeatedly.
class LRUCache {
  constructor(maxSize = 14) {
    this.maxSize = maxSize
    this.map = new Map()
  }
  get(key) {
    if (!this.map.has(key)) return undefined
    const v = this.map.get(key)
    // refresh
    this.map.delete(key)
    this.map.set(key, v)
    return v
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.maxSize) {
      const first = this.map.keys().next().value
      this.map.delete(first)
    }
  }
}
const pageCache = new LRUCache(14)

let pdfjsPromise = null

// Where the pdf.js web worker is served from. Defaults to the app root; an embedding host that
// keeps the worker elsewhere can override it — either by calling configurePdfWorker(url) before
// opening a PDF, or by setting window.__BOOKIE_WORKER_SRC__ (handy for the <script>-tag embed).
let workerSrc = '/pdf.worker.min.mjs'
export function configurePdfWorker(src) {
  if (src) workerSrc = src
}

function loadPdfjs() {
  if (typeof window === 'undefined') {
    throw new Error('pdfLoader can only be used on the client')
  }
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((mod) => {
      if (!mod.GlobalWorkerOptions.workerSrc) {
        mod.GlobalWorkerOptions.workerSrc = window.__BOOKIE_WORKER_SRC__ || workerSrc
      }
      return mod
    })
  }
  return pdfjsPromise
}

/**
 * Load a PDF from a File, Blob, ArrayBuffer, or URL string.
 * Returns a PDFDocumentProxy (`.numPages`, `.getPage(n)`).
 */
export async function loadPdf(source) {
  const pdfjs = await loadPdfjs()
  let task
  if (typeof source === 'string') {
    task = pdfjs.getDocument(source)
  } else if (source instanceof ArrayBuffer) {
    task = pdfjs.getDocument({ data: source })
  } else if (source instanceof Blob || source instanceof File) {
    const buf = await source.arrayBuffer()
    task = pdfjs.getDocument({ data: buf })
  } else {
    throw new Error('loadPdf: unsupported source type')
  }
  const pdfDoc = await task.promise
  // assign a small uid for caching keys so the same PDF file reuses cache entries
  if (!pdfDoc.__uid) pdfDoc.__uid = Math.random().toString(36).slice(2)
  return pdfDoc
}

// Cached WebGL max texture size. Queried once via a throwaway context so the PDF
// rasterizer (which runs outside the R3F <Canvas>, with no `gl` handle) can cap
// canvas dimensions to what the GPU accepts — otherwise the driver silently
// rescales an oversized texture to a power-of-two and blurs it.
let _maxTextureSize = null
function getMaxTextureSize() {
  if (_maxTextureSize) return _maxTextureSize
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') || c.getContext('webgl')
    _maxTextureSize = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 4096
  } catch {
    _maxTextureSize = 4096
  }
  return _maxTextureSize
}

// Find the bounding box of actual content (ink) on a rendered page, so we can trim the PDF's own
// built-in white margins. Scans a DOWNSCALED copy (fast: ~400 px wide) for non-near-white,
// non-transparent pixels and maps the box back to full-res coords. Falls back to the full page for
// a blank/solid-background page or if the canvas is unexpectedly tainted.
function detectContentBBox(src, w, h) {
  const SCAN = 400
  const sw = Math.max(1, Math.min(SCAN, w))
  const sh = Math.max(1, Math.round((h * sw) / w))
  const small = document.createElement('canvas')
  small.width = sw
  small.height = sh
  const sctx = small.getContext('2d', { willReadFrequently: true })
  sctx.imageSmoothingEnabled = true
  sctx.drawImage(src, 0, 0, sw, sh)
  let data
  try { data = sctx.getImageData(0, 0, sw, sh).data } catch { return { x: 0, y: 0, w, h } }

  const THRESH = 245   // luminance ≥ this (near-white) counts as background
  let minX = sw, minY = sh, maxX = -1, maxY = -1
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4
      if (data[i + 3] < 16) continue   // transparent → background
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      if (lum < THRESH) {
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) return { x: 0, y: 0, w, h }   // blank → full page

  const pad = 1                                                 // don't clip antialiased edges
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad)
  maxX = Math.min(sw - 1, maxX + pad); maxY = Math.min(sh - 1, maxY + pad)
  const fx = w / sw, fy = h / sh
  return {
    x: Math.floor(minX * fx),
    y: Math.floor(minY * fy),
    w: Math.ceil((maxX - minX + 1) * fx),
    h: Math.ceil((maxY - minY + 1) * fy),
  }
}

// Export a function that extracts raw text content from a page for Text-to-Speech
export async function extractPageText(pdf, pageNum) {
  try {
    const page = await pdf.getPage(pageNum)
    const textContent = await page.getTextContent()
    // Join items together. We add a space after each element typically.
    let text = ''
    let lastY = -1
    for (const item of textContent.items) {
      if (lastY !== -1 && Math.abs(item.transform[5] - lastY) > 5) {
        text += '\n' // New line if Y axis drifted significantly
      }
      text += item.str + ' '
      lastY = item.transform[5]
    }
    return text.replace(/\s+/g, ' ').trim()
  } catch (e) {
    console.error('Failed to extract text from page', pageNum, e)
    return ''
  }
}

/**
 * Render a PDF page to a sharp HTMLCanvasElement sized for crisp 3D-texture display.
 *
 * `scale` is a logical quality multiplier; the page is rasterized at scale × devicePixelRatio
 * physical pixels so the texture carries enough detail to stay sharp when the camera zooms in.
 * The canvas is clamped to the GPU's max texture size so it is never silently downscaled.
 *
 * CONTENT-AWARE MARGIN: the PDF's own (variable) built-in whitespace is trimmed to the detected
 * content bounding box, then the content is scaled (aspect-preserving) and centered inside a single
 * uniform `margin` (fraction of the canvas). Result: every book gets the SAME margin regardless of
 * how it was typeset — a fixed % alone couldn't, because each PDF bakes in its own margins.
 * (Trade-off: page headers/footers/page-numbers are ink too, so they're part of the content box.)
 */
export async function renderPdfPageToCanvas(pdf, pageNum, scale = 3, margin = 0.06, mode = 'paper') {
  // Use a cache key so identical requests return the same rendered canvas (cached promise)
  const pdfId = pdf.__uid || 'unknown'
  const cacheKey = `${pdfId}_${pageNum}_${scale}_${margin}_${mode}`

  // If there's already a promise for this render, await and return a cloned canvas from it
  const existing = pageCache.get(cacheKey)
  if (existing) {
    const cachedCanvas = await existing
    const clone = document.createElement('canvas')
    clone.width = cachedCanvas.width
    clone.height = cachedCanvas.height
    clone.getContext('2d').drawImage(cachedCanvas, 0, 0)
    return clone
  }

  // Otherwise, create the render promise and store it in the cache immediately to avoid races
  const renderPromise = (async () => {
    const page = await pdf.getPage(pageNum)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const maxTex = getMaxTextureSize()

    let physScale = scale * dpr
    const base = page.getViewport({ scale: 1 })
    const longest = Math.max(base.width, base.height) * physScale
    if (longest > maxTex) physScale *= maxTex / longest

    const viewport = page.getViewport({ scale: physScale })
    const physW = Math.ceil(viewport.width)
    const physH = Math.ceil(viewport.height)

    const inner = document.createElement('canvas')
    inner.width = physW
    inner.height = physH
    const innerCtx = inner.getContext('2d')
    innerCtx.imageSmoothingEnabled = true
    innerCtx.fillStyle = '#ffffff'
    innerCtx.fillRect(0, 0, physW, physH)
    await page.render({ canvasContext: innerCtx, canvas: inner, viewport }).promise

    const bb = detectContentBBox(inner, physW, physH)
    const canvas = document.createElement('canvas')
    canvas.width = physW
    canvas.height = physH
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true

    const availW = physW * (1 - 2 * margin)
    const availH = physH * (1 - 2 * margin)
    const s = Math.min(availW / bb.w, availH / bb.h, 1.6)
    const drawW = bb.w * s, drawH = bb.h * s
    const dx = (physW - drawW) / 2, dy = (physH - drawH) / 2

    if (mode === 'dark') {
      ctx.fillStyle = '#1a1a2e'
      ctx.fillRect(0, 0, physW, physH)
      const tmp = document.createElement('canvas')
      tmp.width = bb.w
      tmp.height = bb.h
      const tctx = tmp.getContext('2d')
      tctx.filter = 'invert(1) brightness(1.2)'
      tctx.drawImage(inner, bb.x, bb.y, bb.w, bb.h, 0, 0, bb.w, bb.h)
      ctx.drawImage(tmp, 0, 0, bb.w, bb.h, dx, dy, drawW, drawH)
    } else {
      const tint = mode === 'sepia' ? '#fbf0d9' : '#FAF8F5'
      ctx.fillStyle = tint
      ctx.fillRect(0, 0, physW, physH)
      ctx.globalCompositeOperation = 'multiply'
      ctx.drawImage(inner, bb.x, bb.y, bb.w, bb.h, dx, dy, drawW, drawH)
      ctx.globalCompositeOperation = 'source-over'
    }

    return canvas
  })()

  pageCache.set(cacheKey, renderPromise)

  const final = await renderPromise
  const clone = document.createElement('canvas')
  clone.width = final.width
  clone.height = final.height
  clone.getContext('2d').drawImage(final, 0, 0)
  return clone
}
