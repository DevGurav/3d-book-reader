# 3D Book Reader (Bookie)

Open any PDF and read it on a realistic 3D book in the browser — two-page spreads, a clean
control sidebar, zoom-into-any-section, reading modes, and an accessibility-focused reflow mode.
Built with Next.js and React Three Fiber.

## Features

- **Open any PDF** — fully client-side; nothing is uploaded. Rendered with pdf.js.
- **3D two-page spread** — PDF pages painted onto the real page surfaces of a 3D book model.
- **Control sidebar** — all controls in one right-hand panel: Open PDF, reading mode, reflow,
  zoom/reset, and page navigation.
- **Zoom into any section** — scroll to zoom toward the cursor, drag to pan, **Reset view** to
  re-frame. Pages re-render at higher resolution as you zoom in, so text stays crisp.
- **Reading modes** — Paper, Sepia, and Night, each with matched background and lighting.
- **Reflow mode** — re-typesets extracted text with adjustable font size, line spacing, and
  weight (Light / Normal / Bold) for comfortable reading.
- **Navigation** — Prev / Next, plus `←` / `→` / `Space` shortcuts (one spread at a time).

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI | React 19 |
| 3D rendering | React Three Fiber 9 + @react-three/drei 10 |
| 3D engine | Three.js |
| PDF rendering | pdf.js (`pdfjs-dist`) |
| Model format | glTF binary (`.glb`) |

## Requirements

- Node.js **20.9+** (required by Next.js 16)
- npm

## Getting started

```bash
git clone https://github.com/DevGurav/3d-book-reader.git
cd 3d-book-reader
npm install
npm run dev
```

Open http://localhost:3000, click **Open PDF**, and start reading.

## Controls

| Action | How |
|---|---|
| Rotate the book | Left-drag |
| Zoom into a section | Scroll wheel (zooms toward the cursor) |
| Pan | Right-drag / two-finger drag |
| Reset the view | **Reset view** button (sidebar) |
| Turn pages | **Prev / Next** buttons or `←` / `→` / `Space` |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server (hot reload) |
| `npm run build` | Production build |
| `npm start` | Serve the production build |

## Project structure

```
app/                      Next.js App Router (layout, page, global styles)
components/BookViewer.jsx React Three Fiber book scene — paints PDF canvases onto page meshes
lib/pdfLoader.js          Loads PDFs and rasterizes pages to canvas (pdf.js)
lib/reflow.js             Text extraction + re-typesetting for reflow mode
public/models/book.glb    The 3D book model loaded at runtime
public/models/Ultimatefinal.blend  Editable Blender source for the model
public/pdf.worker.min.mjs pdf.js web worker
```

## The 3D model

`public/models/book.glb` is loaded at runtime; PDF page canvases map onto the meshes
`left-top-page` and `right-top-page`. To edit the model, open
`public/models/Ultimatefinal.blend` in Blender and re-export the `.glb`.

## License

[MIT](LICENSE)
