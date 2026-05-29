# 3D Book Reader — Buyer Guide

Open any PDF and read it on a realistic 3D book in the browser: two-page spreads,
zoom-into-any-section, Paper/Sepia/Night reading modes, and an accessibility
reflow mode. 100% client-side — **no PDF is ever uploaded to a server.**

## 1. Requirements

- **Node.js 20.9+** and npm.
- A modern WebGL2 browser (Chrome, Edge, Firefox, Safari).

## 2. Quick start

```bash
npm install
npm run dev      # http://localhost:3000  (hot reload)
```

Production:

```bash
npm run build
npm start        # serves the optimized build
```

The app prerenders as a fully static, client-side page with no backend. Deploy to
**Vercel or Netlify with zero config**. For a **pure-static** host (S3 + CDN,
GitHub Pages, itch.io), uncomment `output: 'export'` in `next.config.mjs`, run
`npm run build`, and serve the generated `out/` folder.

## 3. Configuration

All branding and behavior live in one file — **`lib/bookieConfig.js`**. Edit
`DEFAULT_CONFIG` and rebuild; no component code changes needed.

| Option | Type | Default | What it does |
|---|---|---|---|
| `title` | string | `'Bookie 3D'` | Label at the top of the control panel |
| `accent` | hex color | `'#e8a838'` | Highlight color (active buttons, "Next") |
| `coverColor` | hex color | `'#1a2744'` | 3D book cover color |
| `defaultMode` | `'paper'`/`'sepia'`/`'dark'` | `'paper'` | Initial reading mode |
| `defaultReflow` | boolean | `false` | Start in reflow (re-typeset) mode |
| `pdfUrl` | string | `''` | Auto-load this PDF on start (embed mode) |
| `modelUrl` | string | `'/models/book.glb'` | Where the 3D book model is served from |
| `pageLift` | number | `0.03` | How snugly the top pages sit on the stack (lower = snugger; ≈0 looks flush) |
| `showSidebar` | boolean | `true` | Show the whole control panel |
| `allowOpen` | boolean | `true` | Show the "Open PDF" file picker |
| `showModes` | boolean | `true` | Show the Paper/Sepia/Night switch |
| `showView` | boolean | `true` | Show Zoom / Reset view |
| `showReflow` | boolean | `true` | Show the Reflow controls |
| `showNav` | boolean | `true` | Show Prev/Next + page counter |

## 4. URL parameters (great for embedding)

A safe subset of options can be set per-instance via the URL — no rebuild needed.
This is how you embed a **specific** book on a page:

```text
/?pdf=/books/guide.pdf&mode=sepia&accent=%23c0392b&open=0&title=My%20Catalog
```

| Param | Maps to | Example |
|---|---|---|
| `pdf` | `pdfUrl` | `pdf=/books/guide.pdf` |
| `title` | `title` | `title=My%20Catalog` |
| `accent` | `accent` (hex only) | `accent=%23c0392b` |
| `cover` | `coverColor` (hex only) | `cover=%23222831` |
| `mode` | `defaultMode` | `mode=dark` |
| `reflow` | `defaultReflow` | `reflow=1` |
| `sidebar` | `showSidebar` | `sidebar=0` |
| `open` | `allowOpen` | `open=0` |
| `modes` / `view` / `reflowUi` / `nav` | the matching `show*` toggle | `nav=0` |

Booleans accept `1/0`, `true/false`, `yes/no`, `on/off`. Colors must be valid hex
(`#rgb` or `#rrggbb`) or they're ignored.

### Embedding on any site (iframe)

```html
<iframe
  src="https://your-host/?pdf=https://your-host/books/guide.pdf&open=0"
  style="width:100%;height:80vh;border:0"
  title="3D Book"
></iframe>
```

> The PDF URL must be reachable by the browser (same-origin, or served with CORS
> headers allowing your site).

## 4b. Standalone widget — embed on ANY site (no Next.js)

Besides hosting the full Next.js app, you can ship a single self-contained bundle that drops into
any plain HTML page (WordPress, Shopify, a static site, etc.):

```bash
npm run build:embed
```

This produces an `embed-dist/` folder containing `bookie.js`, the `book.glb` model, the
`pdf.worker.min.mjs` worker, a `demo.html`, and a `README.md`. Upload those files to your site and:

```html
<div data-bookie
     data-pdf="/book.pdf" data-model="/book.glb" data-worker="/pdf.worker.min.mjs"
     style="width:100%;height:80vh"></div>
<script type="module" src="/bookie.js"></script>
```

Every `<div data-bookie>` becomes a reader. Configure each one with `data-*` attributes
(`data-pdf`, `data-accent`, `data-cover`, `data-mode`, `data-show-open`, …) — the full
list is in `embed/README.md`. Serve over http(s); module scripts don't run from `file://`.

## 5. Replacing the 3D book model

`public/models/book.glb` is loaded at runtime; PDF pages map onto the meshes
named `left-top-page` and `right-top-page`. To customize the book, edit
`public/models/Ultimatefinal.blend` in Blender and re-export the `.glb`, keeping
those mesh names.

## 6. Updating the pdf.js worker

If you bump `pdfjs-dist`, refresh the bundled worker:

```bash
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/
```

## 7. Project structure

```text
app/                       Next.js App Router (layout, page, global styles)
components/BookViewer.jsx  R3F scene — paints PDF canvases onto the page meshes
lib/pdfLoader.js           Loads PDFs + rasterizes pages to canvas (pdf.js)
lib/reflow.js              Text extraction + re-typesetting for reflow mode
lib/bookieConfig.js        ← all configuration / branding lives here
public/models/book.glb     The 3D book model loaded at runtime
public/pdf.worker.min.mjs  pdf.js web worker
```

## 8. License

See **`LICENSE-COMMERCIAL.md`** (direct sales) or your marketplace license
(e.g. Envato) for usage terms, and **`THIRD-PARTY-NOTICES.md`** for the bundled
open-source components.
