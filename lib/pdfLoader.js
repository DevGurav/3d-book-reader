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

let pdfjsPromise = null

function loadPdfjs() {
  if (typeof window === 'undefined') {
    throw new Error('pdfLoader can only be used on the client')
  }
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((mod) => {
      if (!mod.GlobalWorkerOptions.workerSrc) {
        mod.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
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
  return task.promise
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
  const page = await pdf.getPage(pageNum)
  const dpr = window.devicePixelRatio || 1
  const maxTex = getMaxTextureSize()

  // Physical render scale = quality × device density, clamped so the canvas ≤ GPU max texture size.
  let physScale = scale * dpr
  const base = page.getViewport({ scale: 1 })
  const longest = Math.max(base.width, base.height) * physScale
  if (longest > maxTex) physScale *= maxTex / longest

  const viewport = page.getViewport({ scale: physScale })
  const physW = Math.ceil(viewport.width)
  const physH = Math.ceil(viewport.height)

  // Render the page over an explicit white bg (so transparent regions read as background for the
  // trim scan, and white→tint multiply works). imageSmoothingEnabled ON for clean raster images.
  const inner = document.createElement('canvas')
  inner.width = physW
  inner.height = physH
  const innerCtx = inner.getContext('2d')
  innerCtx.imageSmoothingEnabled = true
  innerCtx.fillStyle = '#ffffff'
  innerCtx.fillRect(0, 0, physW, physH)
  await page.render({ canvasContext: innerCtx, canvas: inner, viewport }).promise

  // Trim the PDF's built-in margins to the real content, then fit it inside a uniform margin.
  const bb = detectContentBBox(inner, physW, physH)
  const canvas = document.createElement('canvas')
  canvas.width = physW                  // keep the page aspect so it maps cleanly to the page mesh
  canvas.height = physH
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true      // content is scaled now, so smooth it

  const availW = physW * (1 - 2 * margin)
  const availH = physH * (1 - 2 * margin)
  // Fit content to the margin box (aspect-preserving). Cap the upscale at 1.6× so a sparse page
  // (e.g. a chapter title with a few words) isn't blown up — only normal built-in margins get
  // trimmed; very sparse pages just keep extra whitespace instead of giant text.
  const s = Math.min(availW / bb.w, availH / bb.h, 1.6)
  const drawW = bb.w * s, drawH = bb.h * s
  const dx = (physW - drawW) / 2, dy = (physH - drawH) / 2

  if (mode === 'dark') {
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, 0, physW, physH)
    // Invert just the cropped content (black bg → page-dark, ink → light) before placing it.
    const tmp = document.createElement('canvas')
    tmp.width = bb.w
    tmp.height = bb.h
    const tctx = tmp.getContext('2d')
    tctx.filter = 'invert(1)'
    tctx.drawImage(inner, bb.x, bb.y, bb.w, bb.h, 0, 0, bb.w, bb.h)
    ctx.drawImage(tmp, 0, 0, bb.w, bb.h, dx, dy, drawW, drawH)
  } else {
    const tint = mode === 'sepia' ? '#fbf0d9' : '#FAF8F5'
    ctx.fillStyle = tint
    ctx.fillRect(0, 0, physW, physH)
    // Multiply content over the tint: the white bg becomes the page tint, black text stays black —
    // uniformly tinted page, no untinted white rectangle.
    ctx.globalCompositeOperation = 'multiply'
    ctx.drawImage(inner, bb.x, bb.y, bb.w, bb.h, dx, dy, drawW, drawH)
    ctx.globalCompositeOperation = 'source-over'
  }

  return canvas
}
