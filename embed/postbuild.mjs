// Runs after `vite build`. Copies the runtime assets the widget needs (the pdf.js worker and the
// 3D model) plus the demo + readme into embed-dist/, so that folder is a complete, shippable
// drop-in package the buyer can host as-is.
import { copyFileSync, existsSync } from 'node:fs'

const OUT = 'embed-dist'
const files = [
  ['public/pdf.worker.min.mjs', `${OUT}/pdf.worker.min.mjs`],
  ['public/models/book.glb',    `${OUT}/book.glb`],
  ['embed/demo.html',           `${OUT}/demo.html`],
  ['embed/README.md',           `${OUT}/README.md`],
]

for (const [src, dest] of files) {
  if (!existsSync(src)) { console.warn(`postbuild: missing ${src} — skipped`); continue }
  copyFileSync(src, dest)
  console.log(`postbuild: ${src} → ${dest}`)
}
console.log('postbuild: embed-dist is ready to host (serve over http, e.g. `npx serve embed-dist`).')
