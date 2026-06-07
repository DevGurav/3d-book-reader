// Reflow reading mode.
//
// The exact-PDF view rasterizes each page to a bitmap, so font size / line spacing / weight can't
// be changed there. Reflow instead EXTRACTS the document's text (PDF.js getTextContent) and
// RE-TYPESETS it onto the page canvas with reader-chosen typography. Trade-off: full type control,
// but the original PDF layout (columns, figures) is not preserved — ideal for prose.
//
// Hierarchy is PRESERVED: each paragraph keeps the font SIZE it had in the PDF. At pagination we
// derive the document's body size, then scale every paragraph by its size ratio to the body and
// render larger/bolder for headings — so titles and section heads stand out, scaled relative to the
// reader's chosen base font.

const PAGE_ASPECT = 0.72   // page width / height — matches the book page-mesh footprint (x:z)
const CANVAS_H    = 2800   // reflow canvas height in px (width derived); high enough to stay crisp

const BG = { paper: '#FAF8F5', sepia: '#fbf0d9', dark: '#1a1a2e' }
// Foreground per reading mode × darkness level (0 light, 1 normal, 2 bold/darkest).
const FG = {
  paper: ['#3a3a3a', '#1a1a1a', '#000000'],
  sepia: ['#5b4a2f', '#3a2c14', '#241803'],
  dark:  ['#b0b0bb', '#d8d8df', '#ffffff'],
}
const WEIGHT = [400, 600, 800]   // body weight per darkness level
const HEADING_RATIO   = 1.12     // size ÷ body above this ⇒ treat the paragraph as a heading
const HEADING_WEIGHT  = 700      // minimum weight for headings (bolder than body)
const SCALE_MIN       = 0.85     // clamp for sub-body text (captions/footnotes)
const SCALE_MAX       = 2.2      // clamp so a giant title can't blow out the page

const FONT_STACKS = {
  classic: 'Georgia, "Times New Roman", serif',
  dyslexic: 'OpenDyslexic, "Atkinson Hyperlegible", Verdana, Arial, sans-serif',
}

function fontStr(px, weight, fontFamily = 'classic') {
  return `${weight} ${px}px ${FONT_STACKS[fontFamily] || FONT_STACKS.classic}`
}

function layout({ fontPx, lineHeightMul }) {
  const W = Math.round(CANVAS_H * PAGE_ASPECT)
  const H = CANVAS_H
  const margin = Math.round(W * 0.1)               // 10% reading margin
  const lineH = Math.max(1, Math.round(fontPx * lineHeightMul))   // body line height (fallback/spacer)
  return { W, H, margin, lineH }
}

/**
 * Extract paragraphs (in reading order) across the whole document, each as `{ text, size }` where
 * `size` is the paragraph's font size in PDF units (tallest line item). Heuristic line→paragraph
 * stitching: a new paragraph starts on a large vertical gap, a first-line indent, OR a font-size
 * change (so a heading never merges into the body run). Trailing hyphens are joined.
 */
export async function extractParagraphs(pdf) {
  const paragraphs = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()

    // 1) group text items into visual lines by baseline Y; track each line's tallest item height
    const lines = []
    let cur = null
    for (const it of content.items) {
      const h = it.height || Math.abs(it.transform?.[3]) || 10
      const y = it.transform?.[5] ?? 0
      const x = it.transform?.[4] ?? 0
      if (!cur || Math.abs(y - cur.y) > h * 0.5) {
        if (cur) lines.push(cur)
        cur = { y, x, h, text: '' }
      }
      cur.text += it.str
      cur.h = Math.max(cur.h, h)
      if (it.hasEOL) { lines.push(cur); cur = null }
    }
    if (cur) lines.push(cur)

    // 2) median line gap (for paragraph-break detection)
    const realGaps = []
    for (let i = 1; i < lines.length; i++) realGaps.push(Math.abs(lines[i - 1].y - lines[i].y))
    realGaps.sort((a, b) => a - b)
    const medGap = realGaps.length ? realGaps[Math.floor(realGaps.length / 2)] : 0

    // 3) stitch lines into paragraphs, breaking on gap / indent / size-change
    let para = null   // { text, size }
    let prev = null
    const flush = () => { if (para && para.text.trim()) paragraphs.push(para); para = null }
    for (const ln of lines) {
      const text = ln.text.replace(/\s+/g, ' ').trim()
      if (!text) { flush(); prev = null; continue }
      const gap = prev ? Math.abs(prev.y - ln.y) : 0
      const indented = prev ? ln.x - prev.x > ln.h * 0.9 : false
      const sizeChange = para ? Math.abs(ln.h - para.size) > para.size * 0.18 : false
      if (para && (gap > medGap * 1.6 || indented || sizeChange)) flush()
      if (!para) para = { text, size: ln.h }
      else {
        if (para.text.endsWith('-')) para.text = para.text.slice(0, -1) + text
        else para.text += ' ' + text
        para.size = Math.max(para.size, ln.h)
      }
      prev = ln
    }
    flush()
  }
  return paragraphs.filter((p) => p.text.trim().length > 0)
}

// Document body font size = char-count-weighted median of paragraph sizes (prose dominates, so the
// median lands on body text, not on the few short headings).
function bodySize(paragraphs) {
  const samples = []
  for (const p of paragraphs) {
    const n = Math.max(1, Math.round(p.text.length / 20))
    for (let i = 0; i < n; i++) samples.push(p.size || 0)
  }
  if (!samples.length) return 1
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)] || 1
}

/**
 * Wrap paragraphs into pages. Each page is an array of line objects `{ text, px, weight, lineH }`
 * so headings (larger PDF size) render bigger + bolder than body, scaled to the reader's base
 * `fontPx`. Pages fill by accumulated pixel height (line heights vary), not a fixed line count.
 * Depends on the typography settings, so re-run when they change.
 */
export function paginate(paragraphs, { fontPx, lineHeightMul, darkness, fontFamily = 'classic' }) {
  if (!paragraphs?.length) return []
  const { W, H, margin, lineH: bodyLineH } = layout({ fontPx, lineHeightMul })
  const body = bodySize(paragraphs)
  const ctx = document.createElement('canvas').getContext('2d')
  const maxW = W - margin * 2
  const usableH = H - margin * 2

  const pages = []
  let pageLines = []
  let usedH = 0
  const flush = () => { if (pageLines.length) { pages.push(pageLines); pageLines = []; usedH = 0 } }
  const push = (ln) => {
    if (usedH + ln.lineH > usableH && pageLines.length) flush()
    pageLines.push(ln)
    usedH += ln.lineH
  }

  for (const para of paragraphs) {
    const scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, (para.size || body) / body))
    const isHeading = scale > HEADING_RATIO
    const px = Math.max(1, Math.round(fontPx * scale))
    const weight = isHeading ? Math.max(HEADING_WEIGHT, WEIGHT[darkness] ?? 600) : (WEIGHT[darkness] ?? 600)
    const lineH = Math.max(1, Math.round(px * lineHeightMul))

    // extra breathing room above a heading (unless it starts a page)
    if (isHeading && pageLines.length) push({ text: '', px: fontPx, weight, lineH: Math.round(bodyLineH * 0.5) })

    ctx.font = fontStr(px, weight, fontFamily)
    let line = ''
    const emit = (t) => push({ text: t, px, weight, lineH })
    for (const word of para.text.split(' ')) {
      const test = line ? line + ' ' + word : word
      if (line && ctx.measureText(test).width > maxW) { emit(line); line = word }
      else line = test
    }
    if (line) emit(line)

    // paragraph spacer (body-height blank line), skipped at the very bottom of a page
    if (pageLines.length && usedH + bodyLineH <= usableH) {
      pageLines.push({ text: '', px: fontPx, weight, lineH: bodyLineH })
      usedH += bodyLineH
    }
  }
  flush()
  return pages
}

/** Render one page of wrapped line objects to a tinted, typeset canvas for injection onto a page mesh. */
export function renderReflowPage(lines, { fontPx, lineHeightMul, darkness, mode, fontFamily = 'classic' }) {
  const { W, H, margin, lineH: bodyLineH } = layout({ fontPx, lineHeightMul })
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  ctx.fillStyle = BG[mode] || BG.paper
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = (FG[mode] || FG.paper)[darkness] ?? (FG[mode] || FG.paper)[1]
  ctx.textBaseline = 'top'
  let y = margin
  for (const ln of lines || []) {
    if (ln && ln.text) {
      ctx.font = fontStr(ln.px ?? fontPx, ln.weight ?? (WEIGHT[darkness] ?? 600), fontFamily)
      ctx.fillText(ln.text, margin, y)
    }
    y += ln?.lineH ?? bodyLineH
  }
  return c
}
