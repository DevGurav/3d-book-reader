# Bookie 3D – Project Documentation & Journey

This document serves as a comprehensive guide to **Bookie 3D**, detailing how the project was built, the technologies used, the logic behind core features, and the chronological development journey.

## Table of Contents
1. [Project Overview](#project-overview)
2. [Tech Stack & Dependencies](#tech-stack--dependencies)
3. [Architecture & Folders](#architecture--folders)
4. [Step-by-Step Development Journey](#step-by-step-development-journey)
5. [Core Features In-Depth](#core-features-in-depth)

---

## Project Overview
**Bookie 3D** is a fully client-side, in-browser PDF reader that renders documents onto a realistic 3D book model. Instead of reading a flat scrollable layout, users get a tactile two-page spread that can be rotated, tilted, and zoomed into.
Our main focus was **Accessibility, Interactivity, and Polish**—which led to the implementation of visual Reading Modes, Reflow (re-typesetting), Text-to-Speech narration, and a Dictionary/Wikipedia lookup overlay. 100% of the processing happens in the browser, assuring total privacy.

---

## Tech Stack & Dependencies

- **Framework:** Next.js 16.2.6 (Turbopack) & React 19. Provides Server-Side Rendering (SSR) for the landing page (for SEO) while keeping the actual 3D Reader application client-side.
- **3D Rendering:** `three` (Three.js), `@react-three/fiber`, and `@react-three/drei`. Used to import, light, and interact with the `.glb` 3D Book model.
- **PDF Engine:** `pdfjs-dist` (PDF.js by Mozilla). Responsible for parsing PDF binary data, rendering specific pages to HTML5 `<canvas>` elements, and extracting text for accessibility features.
- **Bundling / Embedding:** Vite is used specifically for the widget-building script (`npm run build:embed`), compiling a standalone, framework-agnostic version of the reader.
- **External APIs:** 
  - Free Dictionary API (`api.dictionaryapi.dev`) for word definitions.
  - Wikipedia REST API (`en.wikipedia.org`) for encyclopedia summaries.
- **Browser APIs:**
  - `window.speechSynthesis` (Web Speech API) for Text-to-Speech.
  - `window.getSelection` for text selection tracking.
  - HTML5 `Audio` for UI sound effects (page flip sounds).

---

## Architecture & Folders

- **`app/`**: Next.js App Router.
  - `page.js`: The marketing SEO-friendly landing page.
  - `reader/page.js`: The dedicated route for the 3D application.
- **`components/`**: React components.
  - `BookReader.jsx`: The "Brain". Handles app state (PDF doc, page numbers, UI toggles, text selection, TTS engine).
  - `BookViewer.jsx`: The "3D Scene". Uses React Three Fiber to light and position the `.glb` book model.
  - `Landing.jsx`, `HeroBook.jsx`: Marketing components.
- **`lib/`**: Utility scripts.
  - `pdfLoader.js`: PDF.js wrapper—loads documents, rasterizes them to canvases, and extracts raw text.
  - `reflow.js`: Handles taking extracted text and re-paginating it based on custom fonts and sizes (for low-vision readers).
- **`embed/` & `embed-dist/`**: Scripts for packing the app into a shareable widget.
- **`public/`**: Static assets, including the `.glb` model and the `pdf.worker.min.mjs` script.

---

## Step-by-Step Development Journey

1. **Foundation & 3D Initialization:**
   We started by setting up Next.js and React Three Fiber architecture. Our primary concern was the disparity between conventional DOM-based rendering and WebGL. A Blender-built book model (`.glb`) was loaded into the `<Canvas>` environment. The very first challenge involved calculating the UV maps of the imported mesh so that we could paint 2D HTML `<canvas>` elements—where PDF.js draws pixel-by-page data—as flat `CanvasTexture` surfaces wrapped seamlessly around the 3D meshes of the book's pages.

2. **PDF Parsing Architecture with Web Workers:**
   Rendering complex Vector PDFs on the main thread is computationally heavy and creates massive UI stutter. We integrated `pdfjs-dist` (by Mozilla) and configured it to strictly utilize a dedicated Web Worker (`pdf.worker.min.mjs`). We wrapped this inside `lib/pdfLoader.js`—which cleanly parses binary array buffers into memory, calculates aspect ratios, and asynchronously generates the backing canvases independent of the React Fiber rendering cycle.

3. **Interactivity & Camera Controls:**
   With static pages rendering correctly, we needed to allow the user to read naturally. We leveraged `@react-three/drei`'s `OrbitControls`. We heavily configured its properties (`enableDamping`, `panSpeed`, `zoomSpeed`) to give it a physical presence. 
   - *Technical Triumph (Adaptive Resolution):* Drawing every page at 4K resolution crashes mobile browsers via memory faults. Instead, we implemented an Adaptive Resolution observer tracking the camera's distance to the book meshes. When a user scrolls to zoom in, `pdfLoader.js` receives a signal to re-render the current spread at a much higher DPI. The texture updates, ensuring text stays crisp *only* when needed, saving VRAM.

4. **Reading Modes & Reflow (Accessibility):**
   - **Reading Modes:** We wanted parity with Kindle and Apple Books. We added customizable "Paper", "Sepia" (warm tints), and "Night" (dark mode) states. This involved manipulating CSS for the surrounding HTML application *and* dynamically swapping Three.js `AmbientLight`/`DirectionalLight` instances and modifying the inner `CanvasTexture` pixel data (via inversion loops) to provide authentic glare-free reading.
   - **Reflow Scripting:** PDFs are rigid and notoriously unsuited for visually impaired readers. We engineered `lib/reflow.js`. This script queries PDF.js for raw text coordinates, maps physical layout positions, reconstructs sentences, and then mathematically re-targets word wrapping into an invisible DOM measuring environment to calculate new "virtual pages" with customizable font sizes safely.

5. **Immersive Audio (Page Flip FX):**
   To increase physical immersion, we integrated HTML5 `Audio`. By creating a singleton audio system within React `useRef`, we hooked an MP3 page-turn sound specifically to the "Next" and "Prev" navigation boundary functions. We circumvented iOS and Chrome "autoplay restrictions" by tying the initialization strictly to trusted `onClick` interactions.

6. **Overcoming Text-to-Speech (TTS) Browser Limitations:**
   We introduced accessibility narration:
   - *The Problem:* Simply feeding `window.speechSynthesis` a 10,000-word page causes Chrome and Safari to silently discard the payload or crash internally.
   - *The Solution:* Inside `BookReader.jsx`, we implemented a robust **recursive sentence-chunking algorithm**. The engine extracts raw text via `lib/pdfLoader.js`, runs regex to split strings precisely by punctuation and newlines, and feeds the sentences piece-by-piece to an internal TTS event-queue (`onend` callbacks triggering the next sentence). If it reaches the end of the text array, it cleanly commands the React state to click "Next Page" and begins reading the subsequent spread without lifting a finger.

7. **The Dictionary & Wikipedia Overlay Conundrum:**
   Being an educational tool, users need to look up concepts directly. However, you cannot highlight text painted onto a WebGL 3D texture using standard native tools.
   - We implemented a transparent, styled "Overlay" DOM element directly on top of the `<Canvas>` screen. 
   - A user selects a word/phrase using standard mouse highlighting (`window.getSelection`).
   - The app fires a parallel `Promise.all` fetch request to both the Free Dictionary API and the Wikipedia REST API. 
   - A constrained floating popup (`lookup-popup`) renders definitions and Wiki summaries tightly to `e.clientY` / `e.clientX`.
   - *The Next.js SSR Bug:* Injecting this massive feature momentarily broke our Next.js Server-Side-Rendering build script (`ReferenceError`). Next.js Turbopack caught duplicate React variable declarations and invalid hooks hoisted during the `npm run build` compilation. We audited the Hook dependency arrays, purged the duplicate variables inside `BookReader.jsx`, and solidified the execution context.

---

## Core Features In-Depth

### 1. Adaptive `BookViewer` & Dynamic Textures
Three.js uses `CanvasTexture()` to read HTML5 canvases. Inside `<BookViewer>`, we pass the active left/right canvases as props. A React `useEffect` listener detects when a user changes pages, triggering `pdfLoader.js` to redraw the offline buffers. We then flag `texture.needsUpdate = true`, which flushes the GPU buffer and redraws the PDF content onto the 3D book model geometry instantly and optimally.

### 2. High-Quality Web Speech Prioritization
Because web speech voices load asynchronously depending on OS, we implemented a `useEffect` loop that listens to `window.speechSynthesis.on('voiceschanged')`. We then filter the returned blob to search for priority keywords (`Google`, `Premium`, `Siri`, `Natural`)—ignoring robotic legacy robotic synthesizers. This is why the reading experience sounds human despite using standard browser APIs without expensive AI voice API costs.

### 3. State Management & Server vs. Client Code Isolation
Because `window`, `document`, and Three.js APIs do not exist on a Node.js server, deploying a Next.js application creates severe hydration mismatch errors if not managed carefully. Next.js statically builds the Homepage fully on the server for lightning-fast SEO (the `<Landing />`), but the entire `<BookReader />` environment executes behind strict conditional client-side barriers. We utilized `useEffect` lazy loaders to postpone 3D canvas hydration until after the page physically paints matching client/server HTML, nullifying the `ReferenceError` crashes.

### 4. Interactive Lookup Scope Limitations
To prevent the Wikipedia / Dictionary popups from fetching entire paragraphs if a user playfully drags their mouse across the screen, the system includes defensive limiters:
```javascript
// Validate selection length (a single word or short phrase, max ~4 words, max 40 chars)
if (!text || text.length > 40 || text.split(' ').length > 4) {
  setPopupPos(null)
  return
}
```
Furthermore, `e.target.closest('#lookup-popup')` prevents infinite nesting or clearing the display when a user tries to scroll down on a particularly long Wikipedia article definition.