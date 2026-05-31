# 3D Book Reader (Bookie)

Open any PDF and read it on a realistic 3D book in the browser — two-page spreads, a clean
control sidebar, zoom-into-any-section, reading modes, and an accessibility-focused reflow mode.
Built with Next.js and React Three Fiber.

📖 **[Read the comprehensive Project Journey & Technical Documentation](./PROJECT_DOCUMENTATION.md)**

**🔗 Live demo: [3d-book-reader.vercel.app](https://3d-book-reader.vercel.app/)**

## Screenshots

| Top View | Sepia Mode | Paper Mode (Reflow On) | Night Mode |
|:---:|:---:|:---:|:---:|
| <img src="./assets/top-view.png" width="200" alt="Top View" /> | <img src="./assets/sepia-mode.png" width="200" alt="Sepia Mode" /> | <img src="./assets/paper-mode-reflow-on.png" width="200" alt="Paper Mode with Reflow" /> | <img src="./assets/night-mode.png" width="200" alt="Night Mode" /> |

## Features

- **Private & Client-Side** — Any PDF opens entirely in your browser using `pdf.js`. No servers, no uploads, 100% privacy.
- **Realistic 3D Immersion** — Your document is painted onto the 3D meshes of a modeled book layout. Complete with high-quality MP3 **Page Flip Audio FX** for tactile navigation.
- **Dynamic 3D Camera Controls** — Intelligent `OrbitControls` let you zoom precisely into any paragraph. Pages adaptively re-render to crystal-clear high resolutions on close-up so text is never blurry.
- **Visual Accessibility (Reflow & Reading Modes)** 
  - Switch visually between **Paper, Sepia, and Night** modes via Three.js ambient lights and `CanvasTexture` filters.
  - Turn on **Reflow Mode** to structurally extract the raw PDF text and mathematically re-typeset it (adjust fonts, weight, and line height manually). Perfect for visual impairments.
- **Text-to-Speech (TTS) Engine** — Sit back and listen. Implements native `speechSynthesis` equipped with recursive recursive paragraph-chunking that bypasses traditional browser memory limits, seamlessly flipping the page automatically when it finishes reading the current spread.
- **Dictionary / Wikipedia Integration** — Double-click any word or drag any phrase onto the interactive text overlay to trigger an API lookup. A fully styled UI popup immediately displays definitions, phonetics, and encyclopedic summaries for powerful learning without leaving the app.
- **Intuitive Navigation** — Right-hand control sidebar, responsive UI, drag & swipe support for touchpads, and `←` / `→` / `Space` keybindings.

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
