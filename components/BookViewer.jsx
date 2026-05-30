'use client'

import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

const MODEL_PATH      = '/models/book.glb'
const RIGHT_PAGE_NAME = 'right-top-page'
const LEFT_PAGE_NAME  = 'left-top-page'
const STACK_NAME      = 'pages_book'

const COVER_MAT = new THREE.MeshStandardMaterial({ color: '#1a2744', roughness: 0.6, metalness: 0.0 })
const PAGES_MAT = new THREE.MeshStandardMaterial({ color: '#FAF8F5', roughness: 0.9, metalness: 0.0 })

const PAGE_BODY_COLORS = { paper: '#FAF8F5', sepia: '#fbf0d9', dark: '#1a1a2e' }

// Node names that make up the paper (the thick stack + the two flat top pages).
const PAGE_NODES = new Set(['pages_book', RIGHT_PAGE_NAME, LEFT_PAGE_NAME])

function meshRole(obj) {
  const parentName = obj.parent?.name ?? ''
  if (parentName === 'cover_book' || obj.name === 'cover_book') return 'cover'
  if (PAGE_NODES.has(parentName) || PAGE_NODES.has(obj.name)) return 'page'
  return null
}

function isStackMesh(obj) {
  return obj.parent?.name === 'pages_book' || obj.name === 'pages_book'
}

// Generate clean planar UVs from vertex positions: U = 0 at the spine → 1 at the fore-edge, V along
// Z. Called from injectCanvas on the EXACT geometry the texture samples, so a degenerate baked V
// (the source GLB ships V collapsed to ~1.0) can never reach the material. Idempotent.
function regenPlanarUV(geo) {
  const pos = geo.attributes.position
  const N = pos.count
  let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity
  for (let i = 0; i < N; i++) {
    const x = pos.getX(i), z = pos.getZ(i)
    if (x < xmin) xmin = x; if (x > xmax) xmax = x
    if (z < zmin) zmin = z; if (z > zmax) zmax = z
  }
  const xr = (xmax - xmin) || 1, zr = (zmax - zmin) || 1
  const spineAtMin = Math.abs(xmin) < Math.abs(xmax)   // spine = the X-extreme nearest 0
  const uv = new Float32Array(N * 2)
  for (let i = 0; i < N; i++) {
    const x = pos.getX(i), z = pos.getZ(i)
    uv[i * 2]     = spineAtMin ? (x - xmin) / xr : (xmax - x) / xr
    uv[i * 2 + 1] = (z - zmin) / zr
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

// Paint the PDF canvas straight onto a page mesh's own (smoothed, curved) surface.
//
// LIT MeshStandardMaterial with the SAME roughness/metalness as the book stack (PAGES_MAT) so the
// page shades identically under the scene lighting — the canvas already carries the reading-mode
// tint, so margin↔stack and content↔margin seams dissolve in every mode (no bright/white rectangle).
// polygonOffset pulls the page slightly forward to avoid depth-fighting with the stack at the border.
//
// Orientation (verified from the slab's UV→world map): U = spine→fore-edge, V: -Z→+Z, so
// flipY=false puts the canvas top at the far edge (upright). The left page's spine sits on its
// right, so its U must be mirrored (repeat.x=-1).
function injectCanvas(mesh, canvas, mirrorX, maxAnisotropy) {
  if (!mesh || !canvas) return undefined
  // Regenerate planar UVs on the EXACT geometry the texture samples — guarantees a non-degenerate
  // V no matter what the source GLB shipped or how React cloned the scene.
  regenPlanarUV(mesh.geometry)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace      = THREE.SRGBColorSpace
  tex.minFilter       = THREE.LinearFilter
  tex.magFilter       = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.anisotropy      = maxAnisotropy
  tex.wrapS           = THREE.ClampToEdgeWrapping
  tex.wrapT           = THREE.ClampToEdgeWrapping
  tex.flipY           = false
  if (mirrorX) { tex.repeat.x = -1; tex.offset.x = 1 }
  tex.needsUpdate = true
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  })
  mesh.material = mat
  return () => { tex.dispose(); mat.dispose() }
}

export function BookViewer({
  rightPageCanvas = null,
  leftPageCanvas  = null,
  onBoundsReady   = null,
  readingMode     = 'paper',
  coverColor      = '#1a2744',
  modelUrl        = MODEL_PATH,
  pageLift        = 0.03,
}) {
  const { scene } = useGLTF(modelUrl)
  const gl = useThree((s) => s.gl)
  const maxAnisotropy = useMemo(() => gl.capabilities.getMaxAnisotropy(), [gl])
  const clonedScene = useMemo(() => scene.clone(true), [scene])

  // Prep the book once: override baked materials (covers + paper keep their lit, tactile look;
  // the top pages start as cream paper before a canvas is injected), then derive the reading-
  // surface bounds (the open spread, not the whole book volume) for tight camera framing.
  const readingBoxes = useMemo(() => {
    clonedScene.traverse((obj) => {
      if (!obj.isMesh) return
      const role = meshRole(obj)
      // Clone the cover template so the configurable color can be set per-instance
      // without mutating the shared module material.
      if (role === 'cover') obj.material = COVER_MAT.clone()
      else if (role === 'page') obj.material = PAGES_MAT.clone()
    })

    const right = clonedScene.getObjectByName(RIGHT_PAGE_NAME)
    const left  = clonedScene.getObjectByName(LEFT_PAGE_NAME)
    clonedScene.updateMatrixWorld(true)

    const bothBox = new THREE.Box3()
    const leftBox = new THREE.Box3()
    const rightBox = new THREE.Box3()

    if (left) {
      leftBox.expandByObject(left)
      bothBox.expandByObject(left)
    }
    if (right) {
      rightBox.expandByObject(right)
      bothBox.expandByObject(right)
    }
    if (bothBox.isEmpty()) bothBox.setFromObject(clonedScene)

    return { both: bothBox, left: leftBox, right: rightBox }
  }, [clonedScene])

  // Report the reading-surface bounds so the camera frames the spread tightly.
  useEffect(() => {
    if (readingBoxes && !readingBoxes.both.isEmpty() && onBoundsReady) onBoundsReady(readingBoxes)
  }, [readingBoxes, onBoundsReady])

  // Apply the configurable cover color (re-runs when a buyer/embed changes the brand color).
  useEffect(() => {
    clonedScene.traverse((obj) => {
      if (obj.isMesh && meshRole(obj) === 'cover' && obj.material?.color) obj.material.color.set(coverColor)
    })
  }, [coverColor, clonedScene])

  // Seat the two top pages just above the stack so they don't look like they float, while keeping
  // them entirely ABOVE the stack (lowest point of the page > highest point of the stack) so the two
  // surfaces never coincide — that's what prevents the z-fighting "strips" over the text. `pageLift`
  // (fraction of stack thickness) is the small remaining gap; tune it by eye. Idempotent: the original
  // Y is stashed and restored each run, so live tuning never accumulates, and material effects (the
  // injected PDF canvases) are untouched.
  useEffect(() => {
    const stack = clonedScene.getObjectByName(STACK_NAME)
    if (!stack) return
    clonedScene.updateMatrixWorld(true)
    const stackBox = new THREE.Box3().setFromObject(stack)
    if (stackBox.isEmpty()) return
    const stackTopY = stackBox.max.y
    const lift = (stackBox.max.y - stackBox.min.y) * pageLift
    for (const name of [LEFT_PAGE_NAME, RIGHT_PAGE_NAME]) {
      const pg = clonedScene.getObjectByName(name)
      if (!pg) continue
      if (pg.userData.origY === undefined) pg.userData.origY = pg.position.y
      pg.position.y = pg.userData.origY      // reset before re-seating (idempotent across re-runs)
      pg.updateMatrixWorld(true)
      const pgBox = new THREE.Box3().setFromObject(pg)
      if (pgBox.isEmpty()) continue
      pg.position.y += (stackTopY + lift) - pgBox.min.y
    }
    clonedScene.updateMatrixWorld(true)
  }, [clonedScene, pageLift])

  // Update paper body color when reading mode changes (the thick stack only — the top pages
  // carry the already-tinted PDF canvas).
  useEffect(() => {
    const color = PAGE_BODY_COLORS[readingMode]
    clonedScene.traverse((obj) => {
      if (obj.isMesh && isStackMesh(obj) && obj.material?.color) obj.material.color.set(color)
    })
  }, [readingMode, clonedScene])

  // Paint the right PDF page onto the real right page mesh (no mirror).
  useEffect(() => {
    const mesh = clonedScene.getObjectByName(RIGHT_PAGE_NAME)
    if (!mesh) return undefined
    if (!rightPageCanvas) { mesh.material = PAGES_MAT.clone(); return undefined }
    return injectCanvas(mesh, rightPageCanvas, false, maxAnisotropy)
  }, [rightPageCanvas, clonedScene, maxAnisotropy])

  // Paint the left PDF page onto the real left page mesh (mirror U — spine is on its right).
  useEffect(() => {
    const mesh = clonedScene.getObjectByName(LEFT_PAGE_NAME)
    if (!mesh) return undefined
    if (!leftPageCanvas) { mesh.material = PAGES_MAT.clone(); return undefined }
    return injectCanvas(mesh, leftPageCanvas, true, maxAnisotropy)
  }, [leftPageCanvas, clonedScene, maxAnisotropy])

  return <primitive object={clonedScene} />
}

useGLTF.preload(MODEL_PATH)
