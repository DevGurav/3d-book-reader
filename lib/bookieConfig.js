// Central product configuration for the 3D Book Reader.
//
// Buyers re-brand and re-tune the reader by editing DEFAULT_CONFIG here — no
// component code changes needed. A safe subset of options can also be set
// per-instance via URL query params, which is what makes embedding work:
//
//   <iframe src="https://your-site/?pdf=/books/guide.pdf&mode=sepia&accent=%23c0392b">
//
// resolveConfig() merges any present query params over DEFAULT_CONFIG.

export const DEFAULT_CONFIG = {
  // Branding / theme
  title:      'Bookie 3D',   // label shown at the top of the control panel
  accent:     '#e8a838',     // highlight color (active buttons, "Next")
  coverColor: '#1a2744',     // 3D book cover material color

  // Initial reading state
  defaultMode:   'paper',    // 'paper' | 'sepia' | 'dark'
  defaultReflow: false,      // start with reflow (re-typeset) mode on

  // Content
  pdfUrl:   '',                    // if set, auto-loads this PDF on start (embed mode)
  modelUrl: '/models/book.glb',    // 3D book model location (relocate when embedding elsewhere)

  // How snugly the top pages sit on the stack (fraction of stack thickness). Lower = snugger,
  // higher = more lifted. Tune by eye; ~0 looks flush, too low can show flicker strips.
  pageLift: 0.03,

  // UI toggles — let a buyer hide controls they don't want
  showSidebar: true,         // the whole right-hand control panel
  allowOpen:   true,         // the "Open PDF" file picker
  showModes:   true,         // Paper / Sepia / Night switch
  showView:    true,         // Zoom / Reset view
  showReflow:  true,         // Reflow text controls
  showNav:     true,         // Prev / Next + page counter
}

const TRUE  = new Set(['1', 'true', 'yes', 'on'])
const FALSE = new Set(['0', 'false', 'no', 'off'])
const MODES = new Set(['paper', 'sepia', 'dark'])
const HEX   = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

// Accept only well-formed hex colors from untrusted query strings; fall back otherwise.
function color(v, fallback) {
  return typeof v === 'string' && HEX.test(v) ? v : fallback
}

/**
 * Merge URL query params over the defaults. Only the subset below is param-overridable
 * (so an embed URL can't, say, point the reader at internal config it shouldn't touch).
 * `search` is a location.search string ("?pdf=…"); pass '' for none.
 */
export function resolveConfig(defaults = DEFAULT_CONFIG, search = '') {
  const cfg = { ...defaults }
  if (!search) return cfg
  const q = new URLSearchParams(search)

  const str  = (k, key = k) => { const v = q.get(k); if (v != null) cfg[key] = v }
  const bool = (k, key = k) => {
    const v = q.get(k)
    if (v == null) return
    const lv = v.toLowerCase()
    if (TRUE.has(lv)) cfg[key] = true
    else if (FALSE.has(lv)) cfg[key] = false
  }

  str('pdf', 'pdfUrl')
  str('model', 'modelUrl')
  str('title')
  cfg.accent     = color(q.get('accent'), cfg.accent)
  cfg.coverColor = color(q.get('cover'),  cfg.coverColor)

  const mode = q.get('mode')
  if (mode && MODES.has(mode)) cfg.defaultMode = mode
  bool('reflow', 'defaultReflow')
  const lift = Number(q.get('lift'))
  if (Number.isFinite(lift) && lift >= 0) cfg.pageLift = lift

  bool('sidebar', 'showSidebar')
  bool('open',    'allowOpen')
  bool('modes',   'showModes')
  bool('view',    'showView')
  bool('reflowUi', 'showReflow')
  bool('nav',     'showNav')

  return cfg
}
