'use client'
// The complete reader, framework-agnostic. Both the Next.js page (app/page.js) and the
// standalone embed bundle (embed/main.jsx) mount this same component, so there is one
// implementation to maintain. Pass `config` to override DEFAULT_CONFIG per-instance
// (the embed reads it from <div data-*> attributes); URL query params still apply on top.
import { Suspense, useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { BookViewer } from './BookViewer'
import { loadPdf, renderPdfPageToCanvas, extractPageText } from '../lib/pdfLoader'
import { extractParagraphs, paginate, renderReflowPage } from '../lib/reflow'
import { DEFAULT_CONFIG, resolveConfig } from '../lib/bookieConfig'

// Reading-resolution tuning.
const BASE_SCALE      = 3     // PDF rasterization quality at rest (× devicePixelRatio)
const MAX_SCALE       = 6     // ceiling when zoomed in (canvas still clamped to GPU max texture size)
const READING_PADDING = 0.06  // uniform margin around the TRIMMED page content (content-aware; consistent across books)
const FRAME_MARGIN    = 1.0  // camera headroom around the reading spread (smaller = larger text)

// Reflow (re-typeset text) reading controls.
const REFLOW_DEFAULTS = { fontPx: 38, lineHeightMul: 1.6, darkness: 1 }
const FONT_MIN = 24, FONT_MAX = 84, FONT_STEP = 4
const SPACE_MIN = 1.2, SPACE_MAX = 2.6, SPACE_STEP = 0.1
const DARKNESS_LABEL = ['Light', 'Normal', 'Bold']

// Below this viewport width the control panel becomes a slide-in drawer instead of a fixed column.
const NARROW_QUERY = '(max-width: 720px)'

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
function CameraFitter({ bookBoxes, layoutMode = 'two', focusOffset = 0, direction = [0, 1, 0.001], margin = FRAME_MARGIN, resetToken = 0 }) {
  const { camera } = useThree()
  const controls = useThree((s) => s.controls)
  
  useEffect(() => {
    if (!bookBoxes || !controls) return
    const fullBox = bookBoxes.both
    const activeBox = layoutMode === 'two' ? bookBoxes.both : (focusOffset === 0 ? bookBoxes.left : bookBoxes.right)
    
    const fullCenter = fullBox.getCenter(new THREE.Vector3())
    const fullSize = fullBox.getSize(new THREE.Vector3())

    const activeCenter = activeBox.getCenter(new THREE.Vector3())
    const activeSize = activeBox.getSize(new THREE.Vector3())

    const fovRad = (camera.fov * Math.PI) / 180
    
    // Calculate distance based on fitting the active portion
    const fitX = (activeSize.x / 2 * margin) / (Math.tan(fovRad / 2) * camera.aspect)
    const fitZ = (activeSize.z / 2 * margin) / Math.tan(fovRad / 2)
    const distance = Math.max(fitX, fitZ)
    
    // At this camera distance, calculate how much physical width is mathematically visible
    const visibleX = distance * Math.tan(fovRad / 2) * camera.aspect * 2

    // Smart camera clamping: keep camera aimed at target page, but don't show empty void 
    // if the rest of the book can fill that void. (Fixes extreme offset on landscape screens)
    let targetX = activeCenter.x
    
    if (visibleX >= fullSize.x * margin) {
      // Screen is wide enough to show everything anyway. Center the full book beautifully.
      targetX = fullCenter.x
    } else {
      // Clamp so the screen edge hugs the book edge instead of empty space
      const minX = fullCenter.x - (fullSize.x * margin)/2 + visibleX/2
      const maxX = fullCenter.x + (fullSize.x * margin)/2 - visibleX/2
      if (minX <= maxX) {
        targetX = Math.max(minX, Math.min(maxX, targetX))
      } else {
        targetX = fullCenter.x
      }
    }

    const finalCenter = activeCenter.clone()
    finalCenter.x = targetX

    const sphereRadius = activeSize.length() / 2
    const dir = new THREE.Vector3(direction[0], direction[1], direction[2]).normalize()
    camera.position.copy(finalCenter).addScaledVector(dir, distance)
    camera.lookAt(finalCenter)
    camera.near = sphereRadius * 0.02
    camera.far = (distance + sphereRadius) * 10
    camera.updateProjectionMatrix()
    controls.target.copy(finalCenter)
    controls.minDistance = sphereRadius * 0.05
    controls.maxDistance = distance * 4
    controls.update()
  }, [bookBoxes, camera, controls, resetToken, layoutMode, focusOffset])
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
    const fovRad = (camera.fov * Math.PI) / 180
    
    const fitX = (size.x / 2 * FRAME_MARGIN) / (Math.tan(fovRad / 2) * camera.aspect)
    const fitZ = (size.z / 2 * FRAME_MARGIN) / Math.tan(fovRad / 2)
    baselineDist.current = Math.max(fitX, fitZ)
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
  dark:  { ambient: 0.85, color: '#ffffff', dir: 0.12 },
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

export function BookReader({ config: overrideConfig }) {
  // Product configuration: DEFAULT_CONFIG ← per-instance override (data-* attrs) ← URL params.
  // Initial value is override-merged (so an embed paints correctly on first frame, no window
  // needed → SSR-safe); the URL-param refinement is applied in the mount effect below.
  const [config, setConfig] = useState(() => ({ ...DEFAULT_CONFIG, ...(overrideConfig || {}) }))

  const [rightPageCanvas, setRightPageCanvas] = useState(null)
  const [leftPageCanvas, setLeftPageCanvas] = useState(null)
  const [bookBoxes, setBookBoxes] = useState(null)
  
  // Layout mode controls whether we view one page at a time or the full two-page spread.
  const [layoutMode, setLayoutMode] = useState('two') // 'one' or 'two'
  // When in 'one' page mode, controls which side of the spread we are looking at (0 = left, 1 = right)
  const [focusOffset, setFocusOffset] = useState(0) 
  const [readingMode, setReadingMode] = useState(config.defaultMode)
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

  // Responsive layout: panel collapses to a slide-in drawer on narrow screens.
  const [isNarrow, setIsNarrow] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [focusMode, setFocusMode] = useState(false)

  // Text-to-Speech State
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [ttsRate, setTtsRate] = useState(1.0)
  const synthRef = useRef(null)
  const [availableVoices, setAvailableVoices] = useState([])

  // Lookup / Text Overlay State
  const [textOverlayActive, setTextOverlayActive] = useState(false)
  const [overlayText, setOverlayText] = useState("")
  const [lookupWord, setLookupWord] = useState("")
  const [dictResult, setDictResult] = useState(null)
  const [wikiResult, setWikiResult] = useState(null)
  const [popupPos, setPopupPos] = useState(null)
  const [lookupLoading, setLookupLoading] = useState(false)

  // Reflow (re-typeset) reading mode
  const [reflowOn, setReflowOn] = useState(config.defaultReflow)
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

  useEffect(() => {
    let canceled = false
    const loadText = async () => {
      if (!textOverlayActive || !pdfDoc) return
      let text = ""
      setOverlayText("Extracting text from page...")
      if (layoutMode === 'two') {
        const t1 = await extractPageText(pdfDoc, leftPageNum)
        text += t1 + "\n\n"
        if (leftPageNum + 1 <= effectivePages) {
          const t2 = await extractPageText(pdfDoc, leftPageNum + 1)
          text += t2
        }
      } else {
        const targetPage = leftPageNum + focusOffset
        if (targetPage <= effectivePages) {
          text += await extractPageText(pdfDoc, targetPage)
        }
      }
      if (!canceled) setOverlayText(text || "No selectable text found on this page.")
    }
    loadText()
    return () => { canceled = true }
  }, [textOverlayActive, leftPageNum, layoutMode, focusOffset, pdfDoc, effectivePages])

  // Apply a freshly-loaded PDF (shared by the file picker and the ?pdf= auto-loader).
  const applyPdf = useCallback((pdf, name) => {
    setPdfDoc(pdf)
    setPdfName(name)
    setNumPages(pdf.numPages)
    setLeftPageNum(1)
    pendingFractionRef.current = null
    setParagraphs(null)   // force re-extraction for reflow on the new document
  }, [])

  const handleTextSelection = async (e) => {
    // Ignore clicks inside the popup itself
    if (e.target.closest('#lookup-popup')) return
    
    // Clear popup if no text selected, or close button clicked
    const selection = window.getSelection()
    const text = selection.toString().trim()

    // Validate selection length (a single word or short phrase, max ~4 words, max 40 chars)
    if (!text || text.length > 40 || text.split(' ').length > 4) {
      setPopupPos(null)
      return
    }

    setPopupPos({ x: e.clientX, y: e.clientY })
    setLookupWord(text)
    setLookupLoading(true)
    setDictResult(null)
    setWikiResult(null)

    try {
      const dRes = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text)}`)
      if (dRes.ok) {
        const dData = await dRes.json()
        setDictResult(dData[0])
      }
      const wRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(text)}`)
      if (wRes.ok) {
        const wData = await wRes.json()
        if (wData.type !== 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found' && wData.title) {
          setWikiResult(wData)
        }
      }
    } catch (err) {
      console.error(err)
    }
    setLookupLoading(false)
  }

  useEffect(() => {
    const cfg = resolveConfig({ ...DEFAULT_CONFIG, ...(overrideConfig || {}) }, window.location.search)
    setConfig(cfg)
    setReadingMode(cfg.defaultMode)
    setReflowOn(cfg.defaultReflow)
    if (!cfg.pdfUrl) return
    let canceled = false
    setLoading(true)
    setError(null)
    loadPdf(cfg.pdfUrl)
      .then((pdf) => { if (!canceled) applyPdf(pdf, cfg.pdfUrl.split('/').pop() || 'document.pdf') })
      .catch((err) => { if (!canceled) setError(`Failed to load PDF: ${err.message}`) })
      .finally(() => { if (!canceled) setLoading(false) })
    return () => { canceled = true }
  }, [applyPdf, overrideConfig])

  // Track viewport width: collapse the panel to a drawer when narrow, expand it when wide.
  const [isPortrait, setIsPortrait] = useState(false)
  useEffect(() => {
    const mqlNarrow = window.matchMedia(NARROW_QUERY)
    const mqlPortrait = window.matchMedia('(orientation: portrait)')
    
    const applyNarrow = () => { setIsNarrow(mqlNarrow.matches); setPanelOpen(!mqlNarrow.matches) }
    const applyPortrait = () => { 
      setIsPortrait(mqlPortrait.matches)
      // Force two-page mode if we switch to landscape (to avoid having one-page mode stuck on desktop)
      if (!mqlPortrait.matches) {
        setLayoutMode('two')
      }
    }
    
    applyNarrow()
    applyPortrait()
    
    mqlNarrow.addEventListener('change', applyNarrow)
    mqlPortrait.addEventListener('change', applyPortrait)
    
    return () => {
      mqlNarrow.removeEventListener('change', applyNarrow)
      mqlPortrait.removeEventListener('change', applyPortrait)
    }
  }, [])

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

  // Text-To-Speech engine
  const handleTTS = async () => {
    if (!window.speechSynthesis) {
      alert("Text-to-speech is not supported in this browser.")
      return
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel()
      setIsSpeaking(false)
      return
    }

    if (!pdfDoc) return

    setIsSpeaking(true)
    try {
      // Extract text depending on one or two page layout
      let text = ""
      if (layoutMode === 'two') {
        text += await extractPageText(pdfDoc, leftPageNum)
        if (leftPageNum + 1 <= effectivePages) {
          text += " " + await extractPageText(pdfDoc, leftPageNum + 1)
        }
      } else {
        const targetPage = leftPageNum + focusOffset
        if (targetPage <= effectivePages) {
          text += await extractPageText(pdfDoc, targetPage)
        }
      }

      if (!text.trim()) {
        setIsSpeaking(false)
        return
      }

      // Fix SpeechSynthesis Error by chunking text into sentences (limits are usually 250 chars)
      const sentences = text.match(/[^.!?]+[.!?]+/g) || [text]
      let currentSentence = 0

      // Priority list: Google/Siri English -> Any English -> Any Natural -> Fallback
      let idealVoice = null
      if (availableVoices.length > 0) {
        idealVoice = 
          availableVoices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Siri') || v.name.includes('Natural'))) || 
          availableVoices.find(v => v.lang.startsWith('en')) || 
          availableVoices[0]
      }

      const speakNextChunk = () => {
        if (currentSentence >= sentences.length) {
          setIsSpeaking(false)
          if (!atLastPage) {
            handleNextPage()
          }
          return
        }

        const chunk = sentences[currentSentence].trim()
        if (!chunk) {
          currentSentence++
          speakNextChunk()
          return
        }

        const utterance = new SpeechSynthesisUtterance(chunk)
        if (idealVoice) utterance.voice = idealVoice
        utterance.rate = ttsRate
        utterance.pitch = 1.0

        synthRef.current = utterance

        utterance.onend = () => {
          currentSentence++
          speakNextChunk()
        }

        utterance.onerror = (e) => {
          if (e.error !== 'canceled') {
            console.error("Speech synthesis error", e)
          }
          setIsSpeaking(false)
        }

        window.speechSynthesis.speak(utterance)
      }

      speakNextChunk()
    } catch (err) {
      console.error(err)
      setIsSpeaking(false)
    }
  }

  // Play the actual MP3 page flip sound
  const playPageFlipSound = () => {
    try {
      if (!flipAudioRef.current) {
        flipAudioRef.current = new window.Audio('/page-flip.mp3')
        flipAudioRef.current.volume = 0.8
      }
      flipAudioRef.current.currentTime = 0
      flipAudioRef.current.play().catch(() => {})
    } catch (e) {
      // Ignore
    }
  }

  const atFirstPage = leftPageNum <= 1 && (layoutMode === 'two' || focusOffset === 0)
  const atLastPage = pdfDoc ? leftPageNum + (layoutMode === 'two' ? 2 : (focusOffset === 0 ? 1 : 2)) > effectivePages : false

  // Step the spread by one (two pages) or step by one page if in one-page mode.
  const handleNextPage = () => {
    if (pdfDoc && atLastPage) return
    playPageFlipSound()
    if (layoutMode === 'one') {
      if (focusOffset === 0) {
        setFocusOffset(1) // Just pan camera to the right page
      } else {
        setLeftPageNum((n) => n + 2) // Flip texture
        setFocusOffset(0) // Start on left page of new spread
      }
    } else {
      setLeftPageNum((n) => n + 2)
    }
  }
  const handlePrevPage = () => {
    if (atFirstPage) return
    playPageFlipSound()
    if (layoutMode === 'one') {
      if (focusOffset === 1) {
        setFocusOffset(0) // Pan camera to left page
      } else {
        setLeftPageNum((n) => Math.max(1, n - 2)) // Flip texture back
        setFocusOffset(1) // Start on right page of old spread
      }
    } else {
      setLeftPageNum((n) => Math.max(1, n - 2))
    }
  }

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); handleNextPage() }
      if (e.key === 'ArrowLeft') { e.preventDefault(); handlePrevPage() }
      if (e.key === 'Escape') setFocusMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [leftPageNum, effectivePages, pdfDoc, layoutMode, focusOffset, atLastPage, atFirstPage])

  const flipAudioRef = useRef(null)
  const swipeStartRef = useRef({ x: 0, y: 0 })
  const onPointerDown = (e) => {
    swipeStartRef.current = { x: e.clientX, y: e.clientY }
  }
  const onPointerUp = (e) => {
    if (!focusMode) return
    const dx = e.clientX - swipeStartRef.current.x
    const dy = e.clientY - swipeStartRef.current.y
    // If it's a genuine swipe left/right
    if (Math.abs(dx) > 40) {
      if (dx < 0) handleNextPage()
      else handlePrevPage()
    } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      // It's a tap or click. Left side goes back, right side goes forward.
      if (e.clientX < window.innerWidth / 2) {
        handlePrevPage()
      } else {
        handleNextPage()
      }
    }
  }

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const pdf = await loadPdf(file)
      applyPdf(pdf, file.name)
    } catch (err) {
      setError(`Failed to load PDF: ${err.message}`)
    } finally {
      setLoading(false)
      e.target.value = ''
    }
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
  const accent = config.accent

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

  // The panel is in document flow on wide screens; on narrow screens it overlays as a slide-in
  // drawer so the 3D viewport keeps the full width.
  const asideStyle = {
    width: isNarrow ? 'min(86vw, 320px)' : 280,
    height: '100%', flexShrink: 0, boxSizing: 'border-box',
    background: 'rgba(14,14,20,0.94)', borderLeft: '1px solid rgba(255,255,255,0.1)',
    display: 'flex', flexDirection: 'column', gap: 20,
    padding: '22px 18px', overflowY: 'auto', fontFamily: 'sans-serif', color: '#fff',
    ...(isNarrow ? {
      position: 'absolute', top: 0, right: 0, zIndex: 15,
      transform: panelOpen ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 0.25s ease', boxShadow: '-8px 0 24px rgba(0,0,0,0.45)',
    } : {}),
  }

  const showAside = config.showSidebar && !focusMode && (isNarrow || panelOpen)

  const activeBox = bookBoxes 
    ? (layoutMode === 'two' ? bookBoxes.both : (focusOffset === 0 ? bookBoxes.left : bookBoxes.right))
    : null

  return (
    <div style={{ width: '100%', height: '100%', background: bg, display: 'flex', overflow: 'hidden', position: 'relative' }}>
      {/* 3D viewport */}
      <div 
        style={{ flex: 1, position: 'relative', minWidth: 0, touchAction: focusMode ? 'none' : 'auto' }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <Canvas camera={{ fov: 45 }} dpr={[1, 2]} frameloop="demand" style={{ width: '100%', height: '100%' }}>
          <ambientLight intensity={light.ambient} color={light.color} />
          <directionalLight position={[0, 6, 1]} intensity={light.dir} />
          <Suspense fallback={null}>
            <BookViewer
              rightPageCanvas={rightPageCanvas}
              leftPageCanvas={leftPageCanvas}
              onBoundsReady={setBookBoxes}
              readingMode={readingMode}
              coverColor={config.coverColor}
              modelUrl={config.modelUrl}
              pageLift={config.pageLift}
            />
          </Suspense>
          <CameraFitter bookBoxes={bookBoxes} layoutMode={layoutMode} focusOffset={focusOffset} resetToken={resetToken} />
          <AdaptiveResolution box={activeBox} baseScale={BASE_SCALE} maxScale={MAX_SCALE} onScale={setRenderScale} />
          <ControlsBridge apiRef={viewApi} />
          <OrbitControls
            makeDefault
            zoomToCursor
            enableRotate={!focusMode}
            enablePan={!focusMode}
            enableZoom={true}
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

      {/* Interactive Text Overlay */}
      {textOverlayActive && (
        <div 
          onMouseUp={handleTextSelection}
          style={{
            position: 'absolute', top: 40, bottom: 40, left: 'max(5%, 40px)', right: showAside ? 320 : 'max(5%, 40px)',
            background: readingMode === 'dark' ? 'rgba(20,20,30,0.92)' : 'rgba(255,255,255,0.92)',
            color: readingMode === 'dark' ? '#eee' : '#111',
            padding: '40px 60px', borderRadius: 12, border: '1px solid rgba(150,150,150,0.2)',
            overflowY: 'auto', zIndex: 10, backdropFilter: 'blur(8px)',
            fontSize: 18, lineHeight: 1.7, fontFamily: 'Georgia, serif',
            whiteSpace: 'pre-wrap', boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            transition: 'background 0.3s, color 0.3s', userSelect: 'text'
          }}
        >
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 24, opacity: 0.6, fontFamily: 'sans-serif', borderBottom: '1px solid rgba(150,150,150,0.2)', paddingBottom: 12 }}>
            Dictionary Mode Active — Select any word to view its meaning
            <button 
              onClick={() => { setTextOverlayActive(false); setPopupPos(null) }}
              style={{ float: 'right', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 20, lineHeight: 0, opacity: 0.8 }}
            >×</button>
          </div>
          <div style={{ userSelect: 'auto', cursor: 'text' }}>
            {overlayText}
          </div>
        </div>
      )}

      {/* Dictionary Popup */}
      {popupPos && (
        <div 
          id="lookup-popup"
          style={{
            position: 'fixed',
            left: Math.max(10, Math.min(popupPos.x + 10, window.innerWidth - 330)),
            top: Math.max(10, Math.min(popupPos.y + 10, window.innerHeight - 410)),
            width: 320, background: '#1e1e24', color: '#fff',
            borderRadius: 10, padding: 20, zIndex: 9999,
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.1)',
            fontFamily: 'sans-serif', maxHeight: 400, overflowY: 'auto'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 18, color: accent }}>{lookupWord}</h3>
            <button onClick={() => setPopupPos(null)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 18 }}>×</button>
          </div>
          
          {lookupLoading ? (
            <div style={{ fontSize: 13, color: '#888' }}>Searching Dictionary & Wikipedia...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {dictResult && (
                <div>
                  <div style={{ fontSize: 12, color: '#aaa', textTransform: 'uppercase', marginBottom: 4 }}>Dictionary</div>
                  {dictResult.phonetic && <div style={{ fontSize: 13, color: '#888', marginBottom: 6 }}>{dictResult.phonetic}</div>}
                  {dictResult.meanings.slice(0, 2).map((m, i) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: accent, fontStyle: 'italic', marginRight: 6 }}>{m.partOfSpeech}</span>
                      <span style={{ fontSize: 13, lineHeight: 1.4 }}>{m.definitions[0].definition}</span>
                    </div>
                  ))}
                </div>
              )}
              
              {wikiResult && wikiResult.extract && (
                <div>
                  <div style={{ fontSize: 12, color: '#aaa', textTransform: 'uppercase', marginBottom: 4 }}>Wikipedia</div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.9 }}>
                    {wikiResult.extract.length > 220 ? wikiResult.extract.substring(0, 220) + '...' : wikiResult.extract}
                  </div>
                </div>
              )}

              {!dictResult && !wikiResult && (
                <div style={{ fontSize: 13, color: '#888' }}>No exact definition or Wikipedia article found.</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Panel toggle — hide/show the control panel */}
      {config.showSidebar && !focusMode && (
        <button
          onClick={() => setPanelOpen((o) => !o)}
          title={panelOpen ? 'Hide panel' : 'Show panel'}
          aria-label={panelOpen ? 'Hide panel' : 'Show panel'}
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 20,
            width: 40, height: 40, borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(14,14,20,0.82)', color: '#fff', cursor: 'pointer',
            fontSize: 18, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {panelOpen ? '×' : '☰'}
        </button>
      )}

      {/* Focus Mode floating controls */}
      {focusMode && (
        <div style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 20,
          display: 'flex', gap: 6, background: 'rgba(14,14,20,0.82)', padding: '6px 8px',
          borderRadius: 24, border: '1px solid rgba(255,255,255,0.18)', alignItems: 'center'
        }}>
          <button 
            onClick={(e) => { e.stopPropagation(); zoomBy(0.8) }} 
            style={{ ...panelBtn(), border: 'none', background: 'transparent', padding: '6px 12px' }}
          >
            Zoom +
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); setFocusMode(false) }}
            style={{ ...panelBtn(), border: 'none', background: 'rgba(255,255,255,0.15)', padding: '6px 16px', borderRadius: 16 }}
          >
            Exit Focus
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); zoomBy(1.25) }} 
            style={{ ...panelBtn(), border: 'none', background: 'transparent', padding: '6px 12px' }}
          >
            Zoom −
          </button>
        </div>
      )}

      {/* Control sidebar (right) — all controls live here */}
      {showAside && (
      <aside style={asideStyle}>
        {/* Header */}
        <div>
          <div style={{ fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)' }}>
            {config.title}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4, wordBreak: 'break-word' }}>
            {pdfName || 'No file open'}
          </div>
        </div>

        {/* Open PDF */}
        {config.allowOpen && (
          <label style={{ ...panelBtn(), textAlign: 'center', userSelect: 'none' }}>
            {loading ? 'Loading…' : 'Open PDF'}
            <input type="file" accept="application/pdf,.pdf" onChange={handleFile} style={{ display: 'none' }} />
          </label>
        )}

        {/* Tools and Audio */}
        <div>
          <div style={sectionLabel}>Reading Tools</div>
          <button
            onClick={() => { setTextOverlayActive(v => { if (v) setPopupPos(null); return !v }) }}
            disabled={!pdfDoc || loading}
            style={{
              ...panelBtn(textOverlayActive, !pdfDoc), width: '100%', marginBottom: 16,
              background: textOverlayActive ? accent : undefined,
              color: textOverlayActive ? '#111' : undefined
            }}
          >
            {textOverlayActive ? 'Close Dictionary Mode' : 'Dictionary Lookup Mode'}
          </button>
          
          <div style={sectionLabel}>Audio</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button
              onClick={() => setTtsRate(r => Math.max(0.5, r - 0.25))}
              style={{ ...panelBtn(), flex: 1 }}
              title="Read Slower"
            >
              Slower
            </button>
            <div style={{ flex: 1, textAlign: 'center', fontSize: 13, background: 'rgba(255,255,255,0.05)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {ttsRate}x
            </div>
            <button
              onClick={() => setTtsRate(r => Math.min(2.0, r + 0.25))}
              style={{ ...panelBtn(), flex: 1 }}
              title="Read Faster"
            >
              Faster
            </button>
          </div>
          <button
            onClick={handleTTS}
            disabled={!pdfDoc || loading}
            style={{
              ...panelBtn(isSpeaking, !pdfDoc), width: '100%',
              background: isSpeaking ? accent : undefined,
              color: isSpeaking ? '#111' : undefined
            }}
          >
            {isSpeaking ? 'Stop Reading' : 'Play Text-to-Speech'}
          </button>
        </div>

        {/* Reading mode */}
        {config.showModes && (
          <div>
            <div style={sectionLabel}>Appearance</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['paper', 'sepia', 'dark']).map((m) => (
                <button key={m} onClick={() => setReadingMode(m)} style={{ ...panelBtn(readingMode === m), flex: 1, padding: '7px 0' }}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
            
            {isPortrait && (
              <>
                <div style={{ ...sectionLabel, marginTop: 16 }}>Layout</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setLayoutMode('one')} style={{ ...panelBtn(layoutMode === 'one'), flex: 1, padding: '7px 0' }}>
                    One Page
                  </button>
                  <button onClick={() => setLayoutMode('two')} style={{ ...panelBtn(layoutMode === 'two'), flex: 1, padding: '7px 0' }}>
                    Two Page
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* View / zoom */}
        {config.showView && (
          <div>
            <div style={sectionLabel}>View</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => zoomBy(0.8)} title="Zoom in (toward the center)" style={{ ...panelBtn(), flex: 1 }}>Zoom +</button>
              <button onClick={() => zoomBy(1.25)} title="Zoom out" style={{ ...panelBtn(), flex: 1 }}>Zoom −</button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button onClick={resetView} style={{ ...panelBtn(), flex: 1 }}>Reset view</button>
              <button onClick={() => setFocusMode(true)} style={{ ...panelBtn(), flex: 1, background: accent, color: '#111' }}>Focus</button>
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 8, lineHeight: 1.5 }}>
              Scroll to zoom toward the cursor · drag to rotate · right-drag to pan
            </div>
          </div>
        )}

        {/* Reflow */}
        {config.showReflow && (
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
                background: reflowOn ? accent : 'rgba(255,255,255,0.08)',
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
        )}

        {/* Navigation — pinned to the bottom of the panel */}
        {config.showNav && (
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
                  background: atLastPage ? 'rgba(255,255,255,0.08)' : accent,
                  color: atLastPage ? '#fff' : '#111', fontWeight: 700,
                }}
              >
                Next →
              </button>
            </div>
            {pdfDoc && (
              <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(255,255,255,0.55)', marginTop: 10, textAlign: 'center' }}>
                {layoutMode === 'one' 
                  ? `Page ${leftPageNum + focusOffset}`
                  : (leftPageNum + 1 <= effectivePages
                    ? `Pages ${leftPageNum}–${leftPageNum + 1}`
                    : `Page ${leftPageNum}`)
                }
                {' / '}{effectivePages}
              </div>
            )}
          </div>
        )}
      </aside>
      )}
    </div>
  )
}
