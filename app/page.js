'use client'
import { Suspense, useState, useEffect, useRef, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { BookViewer } from '../components/BookViewer'
import { loadPdf, renderPdfPageToCanvas } from '../lib/pdfLoader'
import { extractParagraphs, paginate, renderReflowPage } from '../lib/reflow'

// Reading-resolution tuning.
const BASE_SCALE      = 3     // PDF rasterization quality at rest (× devicePixelRatio)
const MAX_SCALE       = 6     // ceiling when zoomed in (canvas still clamped to GPU max texture size)
const READING_PADDING = 0.06  // uniform margin around the TRIMMED page content (content-aware; consistent across books)
const FRAME_MARGIN    = 1.25  // camera headroom around the reading spread (smaller = larger text)

// Reflow (re-typeset text) reading controls.
const REFLOW_DEFAULTS = { fontPx: 38, lineHeightMul: 1.6, darkness: 1 }
const FONT_MIN = 24, FONT_MAX = 84, FONT_STEP = 4
const SPACE_MIN = 1.2, SPACE_MAX = 2.6, SPACE_STEP = 0.1
const DARKNESS_LABEL = ['Light', 'Normal', 'Bold']

// The open book shows a 2-page spread (1–2, 3–4, …): the LEFT page is the odd page, the RIGHT its
// successor. Nav steps by 2. Snap any page number down to its spread's odd left page.
const spreadLeft = (n) => Math.max(1, n % 2 === 0 ? n - 1 : n)

// Small −/+ stepper used by the reflow controls.
function Stepper({ label, onMinus, onPlus }) {
  const btn = {
    width: 26, height: 26, borderRadius: 6, border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(255,255,255,0.1)', color: '#fff', cursor: 'pointer', fontSize: 16, lineHeight: 1,
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span style={{ display: 'inline-flex', gap: 6 }}>
        <button onClick={onMinus} style={btn}>−</button>
        <button onClick={onPlus} style={btn}>+</button>
      </span>
    </span>
  )
}

// Positions the camera and OrbitControls target from a precomputed Box3.
// Bumping `resetToken` re-runs the fit — that's what the sidebar "Reset view" button does.
function CameraFitter({ box, direction = [0, 1.2, 0.8], margin = FRAME_MARGIN, resetToken = 0 }) {
  const { camera } = useThree()
  const controls = useThree((s) => s.controls)
  useEffect(() => {
    if (!box || !controls) return
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const sphereRadius = size.length() / 2
    const fovRad = (camera.fov * Math.PI) / 180
    const distance = (sphereRadius * margin) / Math.sin(fovRad / 2)
    const dir = new THREE.Vector3(direction[0], direction[1], direction[2]).normalize()
    camera.position.copy(center).addScaledVector(dir, distance)
    camera.lookAt(center)
    camera.near = sphereRadius * 0.02
    camera.far = (distance + sphereRadius) * 10
    camera.updateProjectionMatrix()
    controls.target.copy(center)
    // Small min-distance so the user can zoom right up to a single section of the page.
    controls.minDistance = sphereRadius * 0.05
    controls.maxDistance = distance * 4
    controls.update()
  }, [box, camera, controls, resetToken])
  return null
}

// Re-rasterizes the visible page(s) at a higher scale as the camera zooms in, so text
// stays crisp past the rest-framing resolution. Target scale ∝ how much closer than the
// default framing distance the camera is; bucketed to integer steps + debounced to avoid
// thrashing. The output canvas is still hard-clamped to the GPU max texture size in pdfLoader.
function AdaptiveResolution({ box, baseScale, maxScale, onScale }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const baselineDist = useRef(null)
  const lastScale = useRef(baseScale)
  const timer = useRef(null)

  useEffect(() => {
    if (!box) return
    const size = box.getSize(new THREE.Vector3())
    const sphereRadius = size.length() / 2
    const fovRad = (camera.fov * Math.PI) / 180
    baselineDist.current = (sphereRadius * FRAME_MARGIN) / Math.sin(fovRad / 2)
  }, [box, camera])

  useEffect(() => {
    if (!controls) return
    const onChange = () => {
      const baseline = baselineDist.current
      if (!baseline) return
      const dist = camera.position.distanceTo(controls.target)
      const target = Math.max(baseScale, Math.min(maxScale, baseScale * (baseline / dist)))
      const bucketed = Math.round(target)
      if (bucketed === lastScale.current) return
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        lastScale.current = bucketed
        onScale(bucketed)
      }, 250)
    }
    controls.addEventListener('change', onChange)
    return () => {
      controls.removeEventListener('change', onChange)
      clearTimeout(timer.current)
    }
  }, [controls, camera, baseScale, maxScale, onScale])

  return null
}

// Lifts the live OrbitControls + camera out of the Canvas so the sidebar's DOM buttons
// (Zoom ± / Reset view) can drive them.
function ControlsBridge({ apiRef }) {
  const controls = useThree((s) => s.controls)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    apiRef.current = controls ? { controls, camera } : null
  }, [apiRef, controls, camera])
  return null
}

const SCENE_BG = { paper: '#0f0e17', sepia: '#1a1208', dark: '#080808' }
const MODE_LABEL = { paper: 'Paper', sepia: 'Sepia', dark: 'Night' }
// Flat, even reading light: high ambient + soft overhead fill, no harsh side
// gradient and no shadows, so the page reads at uniform brightness top-to-bottom.
const LIGHT = {
  paper: { ambient: 1.05, color: '#ffffff', dir: 0.18 },
  sepia: { ambient: 0.95, color: '#ffe9cf', dir: 0.15 },
  dark:  { ambient: 0.45, color: '#6a5640', dir: 0.08 },
}

function makePlaceholderCanvas(mode = 'paper') {
  const c = document.createElement('canvas')
  c.width = 800
  c.height = 1100
  const ctx = c.getContext('2d')
  const bg = mode === 'dark' ? '#1a1a2e' : mode === 'sepia' ? '#fbf0d9' : '#FAF8F5'
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = mode === 'dark' ? 'rgba(200,200,220,0.25)' : 'rgba(80,80,80,0.2)'
  ctx.font = '18px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.fillText('Open a PDF to begin reading', c.width / 2, c.height / 2)
  return c
}

export default function Home() {
  const [rightPageCanvas, setRightPageCanvas] = useState(null)
  const [leftPageCanvas, setLeftPageCanvas] = useState(null)
  const [bookBox, setBookBox] = useState(null)
  const [readingMode, setReadingMode] = useState('paper')
  const [renderScale, setRenderScale] = useState(BASE_SCALE)

  // View controls: a token the "Reset view" button bumps to re-frame, and a ref to the live
  // OrbitControls/camera (lifted out of the Canvas by ControlsBridge) for the Zoom ± buttons.
  const [resetToken, setResetToken] = useState(0)
  const viewApi = useRef(null)

  // PDF state
  const [pdfDoc, setPdfDoc] = useState(null)
  const [pdfName, setPdfName] = useState('')
  const [leftPageNum, setLeftPageNum] = useState(1)   // left (odd) page of the current spread
  const [numPages, setNumPages] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Reflow (re-typeset) reading mode
  const [reflowOn, setReflowOn] = useState(false)
  const [fontPx, setFontPx] = useState(REFLOW_DEFAULTS.fontPx)
  const [lineHeightMul, setLineHeightMul] = useState(REFLOW_DEFAULTS.lineHeightMul)
  const [darkness, setDarkness] = useState(REFLOW_DEFAULTS.darkness)
  const [paragraphs, setParagraphs] = useState(null)
  // On a reflow⇄normal toggle, the page counts differ; stash the reading fraction and re-apply it
  // once the target mode's page count is known (see the effect below) so we don't jump to page 1.
  const pendingFractionRef = useRef(null)

  // Re-paginate the extracted text whenever reflow typography changes.
  const reflowPages = useMemo(
    () => (reflowOn && paragraphs ? paginate(paragraphs, { fontPx, lineHeightMul, darkness }) : null),
    [reflowOn, paragraphs, fontPx, lineHeightMul, darkness],
  )
  const effectivePages = reflowOn ? (reflowPages?.length ?? 0) : numPages

  // Extract the document's text the first time reflow is enabled for this PDF.
  useEffect(() => {
    if (!reflowOn || !pdfDoc || paragraphs) return
    let canceled = false
    setLoading(true)
    extractParagraphs(pdfDoc)
      .then((ps) => { if (!canceled) setParagraphs(ps) })
      .catch((err) => { if (!canceled) setError(`Reflow extraction failed: ${err.message}`) })
      .finally(() => { if (!canceled) setLoading(false) })
    return () => { canceled = true }
  }, [reflowOn, pdfDoc, paragraphs])

  // Keep the spread valid as reflow pagination shrinks/grows with typography.
  useEffect(() => {
    if (reflowOn && reflowPages && leftPageNum > reflowPages.length) {
      setLeftPageNum(spreadLeft(reflowPages.length))
    }
  }, [reflowOn, reflowPages, leftPageNum])

  // Re-apply the stashed reading fraction after a mode toggle, once the new mode's page count is
  // known (numPages for normal; reflowPages.length for reflow). Maps the position proportionally.
  useEffect(() => {
    if (pendingFractionRef.current == null || !effectivePages) return
    const frac = pendingFractionRef.current
    pendingFractionRef.current = null
    const target = Math.max(1, Math.round(frac * effectivePages))
    setLeftPageNum(Math.min(spreadLeft(target), spreadLeft(effectivePages)))
  }, [effectivePages])

  // Placeholder canvas when no PDF is loaded.
  useEffect(() => {
    if (!pdfDoc) {
      setRightPageCanvas(makePlaceholderCanvas(readingMode))
      setLeftPageCanvas(null)
    }
  }, [pdfDoc, readingMode])

  // Render the spread: LEFT page = leftPageNum, RIGHT page = leftPageNum+1 (blank if past the end).
  // Reflow mode re-typesets the extracted text; otherwise rasterize the PDF.
  useEffect(() => {
    if (!pdfDoc) return
    let canceled = false
    const rightNum = leftPageNum + 1

    if (reflowOn) {
      if (!reflowPages) return   // still extracting / paginating
      const opts = { fontPx, lineHeightMul, darkness, mode: readingMode }
      const l = reflowPages[leftPageNum - 1]
      const r = reflowPages[rightNum - 1]
      setLeftPageCanvas(l ? renderReflowPage(l, opts) : null)
      setRightPageCanvas(r ? renderReflowPage(r, opts) : null)
      return
    }

    renderPdfPageToCanvas(pdfDoc, leftPageNum, renderScale, READING_PADDING, readingMode)
      .then((canvas) => { if (!canceled) setLeftPageCanvas(canvas) })
      .catch((err) => { if (!canceled) setError(`Page ${leftPageNum} render failed: ${err.message}`) })
    if (rightNum <= numPages) {
      renderPdfPageToCanvas(pdfDoc, rightNum, renderScale, READING_PADDING, readingMode)
        .then((canvas) => { if (!canceled) setRightPageCanvas(canvas) })
        .catch(() => {})
    } else {
      setRightPageCanvas(null)   // odd page count → blank right page on the last spread
    }
    return () => { canceled = true }
  }, [pdfDoc, leftPageNum, readingMode, renderScale, reflowOn, reflowPages, fontPx, lineHeightMul, darkness, numPages])

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); handleNextPage() }
      if (e.key === 'ArrowLeft') { e.preventDefault(); handlePrevPage() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [leftPageNum, effectivePages, pdfDoc])

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const pdf = await loadPdf(file)
      setPdfDoc(pdf)
      setPdfName(file.name)
      setNumPages(pdf.numPages)
      setLeftPageNum(1)
      pendingFractionRef.current = null
      setParagraphs(null)   // force re-extraction for reflow on the new document
    } catch (err) {
      setError(`Failed to load PDF: ${err.message}`)
    } finally {
      setLoading(false)
      e.target.value = ''
    }
  }

  const atFirstPage = leftPageNum <= 1
  const atLastPage = pdfDoc ? leftPageNum + 2 > effectivePages : false

  const handleNextPage = () => {
    if (pdfDoc && atLastPage) return
    setLeftPageNum(n => n + 2)
  }

  const handlePrevPage = () => {
    if (atFirstPage) return
    setLeftPageNum(n => Math.max(1, n - 2))
  }

  // "Reset view" — re-run the camera framing.
  const resetView = () => setResetToken((t) => t + 1)

  // "Zoom ±" — dolly the camera along its view direction, clamped to the controls' min/max.
  // factor < 1 zooms in, factor > 1 zooms out.
  const zoomBy = (factor) => {
    const api = viewApi.current
    if (!api) return
    const { controls, camera } = api
    const offset = camera.position.clone().sub(controls.target)
    const dist = Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length() * factor))
    offset.setLength(dist)
    camera.position.copy(controls.target).add(offset)
    controls.update()
  }

  const bg = SCENE_BG[readingMode]
  const light = LIGHT[readingMode]

  // Shared sidebar button style. `active` = highlighted/selected, `disabled` = dimmed.
  const panelBtn = (active = false, disabled = false) => ({
    padding: '8px 12px', fontSize: 13, fontFamily: 'sans-serif',
    borderRadius: 6, border: '1px solid rgba(255,255,255,0.18)',
    background: active ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.08)',
    color: active ? '#111' : '#fff',
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
    fontWeight: active ? 700 : 500, transition: 'background 0.15s, color 0.15s',
  })
  const sectionLabel = {
    fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.4)', fontFamily: 'sans-serif', margin: '0 0 6px',
  }

  return (
    <div style={{ width: '100vw', height: '100vh', background: bg, display: 'flex', overflow: 'hidden' }}>
      {/* 3D viewport */}
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <Canvas camera={{ fov: 45 }} style={{ width: '100%', height: '100%' }}>
          <ambientLight intensity={light.ambient} color={light.color} />
          <directionalLight position={[0, 6, 1]} intensity={light.dir} />
          <Suspense fallback={null}>
            <BookViewer
              rightPageCanvas={rightPageCanvas}
              leftPageCanvas={leftPageCanvas}
              onBoundsReady={setBookBox}
              readingMode={readingMode}
            />
          </Suspense>
          <CameraFitter box={bookBox} resetToken={resetToken} />
          <AdaptiveResolution box={bookBox} baseScale={BASE_SCALE} maxScale={MAX_SCALE} onScale={setRenderScale} />
          <ControlsBridge apiRef={viewApi} />
          <OrbitControls
            makeDefault
            zoomToCursor
            enablePan
            panSpeed={0.5}
            zoomSpeed={1.8}
            enableDamping
            dampingFactor={0.06}
          />
        </Canvas>

        {/* Error toast — floats over the viewport so it stays visible */}
        {error && (
          <div style={{
            position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            padding: '10px 20px', fontSize: 13, fontFamily: 'sans-serif',
            background: 'rgba(220,60,60,0.92)', color: '#fff', borderRadius: 6,
            maxWidth: '80%', cursor: 'pointer',
          }} onClick={() => setError(null)}>
            {error} <span style={{ opacity: 0.6, marginLeft: 8 }}>(click to dismiss)</span>
          </div>
        )}
      </div>

      {/* Control sidebar (right) — all controls live here */}
      <aside style={{
        width: 280, height: '100%', flexShrink: 0, boxSizing: 'border-box',
        background: 'rgba(14,14,20,0.94)', borderLeft: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', flexDirection: 'column', gap: 20,
        padding: '22px 18px', overflowY: 'auto', fontFamily: 'sans-serif', color: '#fff',
      }}>
        {/* Header */}
        <div>
          <div style={{ fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)' }}>
            Bookie 3D
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4, wordBreak: 'break-word' }}>
            {pdfName || 'No file open'}
          </div>
        </div>

        {/* Open PDF */}
        <label style={{ ...panelBtn(), textAlign: 'center', userSelect: 'none' }}>
          {loading ? 'Loading…' : 'Open PDF'}
          <input type="file" accept="application/pdf,.pdf" onChange={handleFile} style={{ display: 'none' }} />
        </label>

        {/* Reading mode */}
        <div>
          <div style={sectionLabel}>Reading mode</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['paper', 'sepia', 'dark']).map((m) => (
              <button key={m} onClick={() => setReadingMode(m)} style={{ ...panelBtn(readingMode === m), flex: 1, padding: '7px 0' }}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        </div>

        {/* View / zoom */}
        <div>
          <div style={sectionLabel}>View</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => zoomBy(0.8)} title="Zoom in (toward the center)" style={{ ...panelBtn(), flex: 1 }}>Zoom +</button>
            <button onClick={() => zoomBy(1.25)} title="Zoom out" style={{ ...panelBtn(), flex: 1 }}>Zoom −</button>
          </div>
          <button onClick={resetView} style={{ ...panelBtn(), width: '100%', marginTop: 6 }}>Reset view</button>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 8, lineHeight: 1.5 }}>
            Scroll to zoom toward the cursor · drag to rotate · right-drag to pan
          </div>
        </div>

        {/* Reflow */}
        <div>
          <div style={sectionLabel}>Reflow text</div>
          <button
            onClick={() => {
              pendingFractionRef.current = effectivePages > 0 ? leftPageNum / effectivePages : 0
              setReflowOn(v => !v)
            }}
            disabled={!pdfDoc}
            title="Re-typeset the text with adjustable font, spacing and weight"
            style={{
              ...panelBtn(reflowOn, !pdfDoc), width: '100%',
              background: reflowOn ? '#e8a838' : 'rgba(255,255,255,0.08)',
              color: reflowOn ? '#111' : '#fff',
            }}
          >
            {reflowOn ? 'Reflow: On' : 'Reflow: Off'}
          </button>
          {reflowOn && pdfDoc && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12, fontSize: 12 }}>
              <Stepper
                label="Font"
                onMinus={() => setFontPx((p) => Math.max(FONT_MIN, p - FONT_STEP))}
                onPlus={() => setFontPx((p) => Math.min(FONT_MAX, p + FONT_STEP))}
              />
              <Stepper
                label="Spacing"
                onMinus={() => setLineHeightMul((s) => Math.max(SPACE_MIN, +(s - SPACE_STEP).toFixed(2)))}
                onPlus={() => setLineHeightMul((s) => Math.min(SPACE_MAX, +(s + SPACE_STEP).toFixed(2)))}
              />
              <button onClick={() => setDarkness((d) => (d + 1) % 3)} style={{ ...panelBtn(), width: '100%' }}>
                Darkness: {DARKNESS_LABEL[darkness]}
              </button>
            </div>
          )}
        </div>

        {/* Navigation — pinned to the bottom of the panel */}
        <div style={{ marginTop: 'auto' }}>
          <div style={sectionLabel}>Navigation</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={handlePrevPage} disabled={atFirstPage} style={{ ...panelBtn(false, atFirstPage), flex: 1 }}>
              ← Prev
            </button>
            <button
              onClick={handleNextPage}
              disabled={atLastPage}
              style={{
                ...panelBtn(false, atLastPage), flex: 1,
                background: atLastPage ? 'rgba(255,255,255,0.08)' : '#e8a838',
                color: atLastPage ? '#fff' : '#111', fontWeight: 700,
              }}
            >
              Next →
            </button>
          </div>
          {pdfDoc && (
            <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(255,255,255,0.55)', marginTop: 10, textAlign: 'center' }}>
              {leftPageNum + 1 <= effectivePages
                ? `Pages ${leftPageNum}–${leftPageNum + 1}`
                : `Page ${leftPageNum}`}
              {' / '}{effectivePages}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
