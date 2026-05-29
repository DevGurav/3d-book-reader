# 3D Book Reader — Embed Widget

A self-contained drop-in: put a PDF on a realistic 3D book on **any** website — no build step,
no framework. This folder (after building) contains everything you need to host:

```text
bookie.js             the widget bundle (ES module — load with <script type="module">)
pdf.worker.min.mjs    pdf.js web worker (loaded at runtime)
book.glb              the 3D book model (loaded at runtime)
demo.html             a working example
```

## Use it

1. Upload `bookie.js`, `pdf.worker.min.mjs`, and `book.glb` to your site (same folder is easiest).
2. Add a sized container and the script:

```html
<div id="reader"
     data-bookie
     data-pdf="/books/guide.pdf"
     data-model="/book.glb"
     data-worker="/pdf.worker.min.mjs"
     style="width:100%;height:80vh"></div>

<script type="module" src="/bookie.js"></script>
```

That's it — every `<div data-bookie>` on the page becomes a reader.

> Serve over **http(s)** (module scripts and the pdf.js worker don't run from `file://`).
> To preview this folder locally: `npx serve .` then open `/demo.html`.

## Options (data-* attributes)

| Attribute | Meaning | Example |
|---|---|---|
| `data-pdf` | PDF to load on start (omit to show the file picker) | `data-pdf="/book.pdf"` |
| `data-model` | 3D model URL | `data-model="/book.glb"` |
| `data-worker` | pdf.js worker URL | `data-worker="/pdf.worker.min.mjs"` |
| `data-title` | Panel title | `data-title="My Catalog"` |
| `data-accent` | Highlight color (hex) | `data-accent="#c0392b"` |
| `data-cover` | Book cover color (hex) | `data-cover="#222831"` |
| `data-mode` | `paper` / `sepia` / `dark` | `data-mode="sepia"` |
| `data-reflow` | Start in reflow mode | `data-reflow="1"` |
| `data-show-open` | Show the "Open PDF" picker | `data-show-open="0"` |
| `data-show-sidebar` / `data-show-modes` / `data-show-view` / `data-show-reflow` / `data-show-nav` | Toggle each control group | `data-show-nav="0"` |

## Manual mount (advanced)

```html
<script type="module">
  import './bookie.js'            // defines window.Bookie
  Bookie.mount(document.getElementById('reader'), { pdfUrl: '/book.pdf', accent: '#c0392b' })
</script>
```

## License

See the commercial license that came with your purchase (`LICENSE-COMMERCIAL.md`) and
`THIRD-PARTY-NOTICES.md`.
