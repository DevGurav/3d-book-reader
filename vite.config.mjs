// Builds the standalone embed widget (embed/main.jsx) into a single self-contained ES module
// at embed-dist/bookie.js. React, three.js, R3F and pdf.js are all bundled in; only the pdf.js
// worker and the .glb model are loaded at runtime from configurable URLs.
//
// This config is for the widget ONLY — the main app still uses Next.js (`npm run build`).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  // Don't auto-copy public/ (it holds the Blender source + a nested models/ path). The postbuild
  // step copies exactly the runtime assets the widget needs into embed-dist/.
  publicDir: false,
  build: {
    target: 'es2020',
    outDir: 'embed-dist',
    emptyOutDir: true,
    lib: {
      entry: 'embed/main.jsx',
      formats: ['es'],
      fileName: () => 'bookie.js',
    },
    rollupOptions: {
      // IIFE/UMD can't code-split; pdf.js is loaded via dynamic import(), so inline everything
      // into the single bookie.js file.
      output: { inlineDynamicImports: true },
    },
  },
})
