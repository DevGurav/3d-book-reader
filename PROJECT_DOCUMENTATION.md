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
   We started by setting up Next.js and React Three Fiber. A Blender-built book model (`.glb`) was loaded into the canvas. Initial hurdles involved mapping 2D HTML Canvas elements (where PDF.js draws) as textures onto the 3D meshes of the book's pages.

2. **PDF Parsing & Rendering:**
   `pdfjs-dist` was integrated via a Web Worker. We built `pdfLoader.js` to render the pages into hidden in-memory `<canvas>` tags. These canvases were then passed to Three.js materials (`CanvasTexture`) so the book would display the actual PDF content.

3. **Interactivity & Camera Controls:**
   We added `@react-three/drei`'s `OrbitControls`, allowing users to drag to rotate and scroll to zoom. We implemented a dynamic resolution system: zooming in triggers PDF.js to re-render the canvas at a much higher DPI, ensuring text stays crisp regardless of camera distance.

4. **Reading Modes & Reflow (Accessibility):**
   - **Reading Modes:** We added "Paper", "Sepia", and "Night" modes, mapping CSS background colors with Three.js ambient lighting and canvas tinting.
   - **Reflow:** For users with low vision or varying screen sizes, PDFs are notoriously hard to read. We built a script to extract text lines, merge them into paragraphs, and dynamically re-calculate DOM bounds to generate new "virtual" pages with custom font sizes (`reflow.js`).

5. **Audio Polish (Page Flip):**
   To increase immersion, we hooked an MP3 page-turn sound to the "Next" and "Prev" navigation functions. This simple addition made the 3D interaction feel significantly more authentic.

6. **Text-to-Speech (TTS) Engine:**
   We introduced an accessibility powerhouse—reading the book out loud.
   - **Challenge:** Pushing huge walls of text into `speechSynthesis` causes most browsers to crash or stop arbitrarily.
   - **Solution:** We used `lib/pdfLoader.js` to extract text from the active page, but internally implemented a **recursive sentence-chunking algorithm** in `BookReader.jsx`. We split text by periods and fed it to the TTS queue piece-by-piece, ensuring uninterrupted playback. We also auto-navigated to the next page once the narration ended.

7. **Dictionary & Wikipedia Overlay:**
   Being an educational tool, users need to look up concepts directly.
   - We implemented an overlay that renders the extracted raw text on top of the screen. 
   - A user selects a word/phrase using standard mouse highlighting (`window.getSelection`).
   - The app fires a dual-fetch request to the Free Dictionary API and the Wikipedia API. 
   - A floating popup then renders definitions and Wiki summaries right where the mouse is positioned.
   - *Hurdle:* Injecting this feature momentarily broke Next.js Server-Side-Rendering due to duplicate hook initializations, which we detected via `npm run build` and squashed by unifying the render states.

---

## Core Features In-Depth

### 1. `BookViewer` & Dynamic Textures
Three.js uses `CanvasTexture()` to read HTML5 canvases. Every time the user turns a page, `pdfLoader.js` re-draws the new PDF pages to the off-screen canvases. React Three Fiber detects this prop change, marks the `texture.needsUpdate = true`, and the 3D mesh updates instantly.

### 2. High-Quality Web Speech Integration
`window.speechSynthesis.getVoices()` is asynchronous. We implemented a `useEffect` listener for the `voiceschanged` event to map and prioritize high-quality local system voices (e.g., "Google", "Siri", "Natural", "Premium") so the book doesn't sound robotic. Speed bounds range from `0.5x` to `2.0x`.

### 3. Server vs. Client Code Isolation
Because Window, Document, and Three.js APIs do not exist on a Node.js server, any components touching them were isolated or conditionally rendered. Next.js statically builds the homepage, but the `BookReader` is explicitly rendered as a client component to avoid `ReferenceError` crashes during build time.