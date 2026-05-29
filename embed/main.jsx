// Standalone embed entry — bundled by Vite into embed-dist/bookie.js.
//
// Drop the bundle on ANY website (no Next.js, no build step) and it auto-mounts the reader into
// every <div data-bookie> on the page, reading options from data-* attributes:
//
//   <div data-bookie data-pdf="/books/guide.pdf" data-mode="sepia" data-show-open="0"></div>
//   <script type="module" src="bookie.js"></script>
//
// You can also mount manually: window.Bookie.mount(document.getElementById('reader'), { pdfUrl: '…' })
import { createRoot } from 'react-dom/client'
import { BookReader } from '../components/BookReader'
import { configurePdfWorker } from '../lib/pdfLoader'

const TRUE  = new Set(['1', 'true', 'yes', 'on'])
const FALSE = new Set(['0', 'false', 'no', 'off'])

// Translate a mount element's data-* attributes into a config override object.
function configFromDataset(el) {
  const d = el.dataset
  const cfg = {}
  const str = (k, key) => { if (d[k] != null && d[k] !== '') cfg[key] = d[k] }
  const bool = (k, key) => {
    if (d[k] == null) return
    const v = String(d[k]).toLowerCase()
    if (TRUE.has(v)) cfg[key] = true
    else if (FALSE.has(v)) cfg[key] = false
  }
  str('pdf', 'pdfUrl')          // data-pdf
  str('model', 'modelUrl')      // data-model
  str('title', 'title')         // data-title
  str('accent', 'accent')       // data-accent
  str('cover', 'coverColor')    // data-cover
  str('mode', 'defaultMode')    // data-mode
  bool('reflow', 'defaultReflow')   // data-reflow
  bool('showSidebar', 'showSidebar')   // data-show-sidebar
  bool('showOpen', 'allowOpen')        // data-show-open
  bool('showModes', 'showModes')       // data-show-modes
  bool('showView', 'showView')         // data-show-view
  bool('showReflow', 'showReflow')     // data-show-reflow
  bool('showNav', 'showNav')           // data-show-nav
  return cfg
}

// Mount the reader into an element (idempotent). The element fills its own box, so give it a size.
export function mount(el, extra = {}) {
  if (!el || el.__bookieRoot) return el?.__bookieRoot
  if (el.dataset.worker) configurePdfWorker(el.dataset.worker)   // data-worker (pdf.js worker URL)
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
  if (el.clientHeight < 40 && !el.style.height) el.style.height = '600px'
  const config = { ...configFromDataset(el), ...extra }
  const root = createRoot(el)
  root.render(<BookReader config={config} />)
  el.__bookieRoot = root
  return root
}

export function init(scope = document) {
  scope.querySelectorAll('[data-bookie]').forEach((el) => mount(el))
}

if (typeof window !== 'undefined') {
  window.Bookie = { mount, init }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init())
  else init()
}
