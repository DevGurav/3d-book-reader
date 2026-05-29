'use client'
// Live 3D book for the landing hero: the real book.glb (via BookViewer) with sample book text
// painted on its pages, gently swaying. Floats over the hero's gradient (transparent canvas).
// Non-interactive and deliberately kept near a front-above angle so it always looks its best.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { BookViewer } from './BookViewer'

const LEFT_LINES = [
  'The mole had been working very hard all the',
  'morning, sweeping and dusting and scrubbing,',
  'until he had dust in his throat and eyes, and',
  'splashes of whitewash all over his black fur.',
  '',
  'Spring was moving in the air above and in the',
  'earth below and around him, penetrating even',
  'his dark and lowly little house with its spirit',
  'of divine discontent and longing. So it was no',
  'wonder that he suddenly flung down his brush',
  'and said, “Bother!” and “Hang spring-cleaning!”',
  'and bolted out of the house without even',
  'waiting to put on his coat.',
]

const RIGHT_LINES = [
  'Something up above was calling him imperiously,',
  'and he made for the steep little tunnel which',
  'answered in his case to the gravelled carriage',
  'drive owned by animals whose residences are',
  'nearer to the sun and air.',
  '',
  'So he scraped and scratched and scrabbled and',
  'scrooged, and then he scrooged again and',
  'scrabbled and scratched and scraped, working',
  'busily with his little paws and muttering to',
  'himself, “Up we go! Up we go!” till at last,',
  'pop! his snout came out into the sunlight, and',
  'he found himself rolling in the warm grass of',
  'a great meadow.',
]

// Draw a believable cream book page with serif text onto a canvas.
function makeSamplePage(side) {
  const c = document.createElement('canvas')
  c.width = 900
  c.height = 1250
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#FAF8F5'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = '#2b2b2b'
  const M = 96
  let y = 150
  if (side === 'left') {
    ctx.font = 'bold 56px Georgia, "Times New Roman", serif'
    ctx.fillText('Chapter One', M, y)
    y += 96
  } else {
    y += 24
  }
  ctx.font = '31px Georgia, "Times New Roman", serif'
  for (const ln of side === 'left' ? LEFT_LINES : RIGHT_LINES) {
    if (ln) ctx.fillText(ln, M, y)
    y += 54
  }
  return c
}

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduce(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return reduce
}

// Frame the camera to the book's bounding sphere, from a front-above angle.
function Framer({ box }) {
  const { camera } = useThree()
  useEffect(() => {
    if (!box) return
    const center = box.getCenter(new THREE.Vector3())
    const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1
    const fov = (camera.fov * Math.PI) / 180
    const dist = (radius * 1.45) / Math.sin(fov / 2)
    const dir = new THREE.Vector3(0, 0.62, 1).normalize()
    camera.position.copy(center).addScaledVector(dir, dist)
    camera.near = Math.max(0.01, radius * 0.05)
    camera.far = dist + radius * 6
    camera.lookAt(center)
    camera.updateProjectionMatrix()
  }, [box, camera])
  return null
}

function Scene() {
  const [box, setBox] = useState(null)
  const center = useRef(new THREE.Vector3())
  const radius = useRef(1)
  const pivot = useRef()
  const reduce = usePrefersReducedMotion()

  const right = useMemo(() => makeSamplePage('right'), [])
  const left = useMemo(() => makeSamplePage('left'), [])

  const onBounds = (b) => {
    setBox(b)
    b.getCenter(center.current)
    radius.current = b.getSize(new THREE.Vector3()).length() / 2 || 1
  }

  useFrame((state) => {
    const g = pivot.current
    if (!g) return
    const t = state.clock.elapsedTime
    const amp = reduce ? 0 : 1
    g.rotation.y = Math.sin(t * 0.45) * 0.30 * amp
    const c = center.current
    g.position.set(c.x, c.y + Math.sin(t * 0.7) * radius.current * 0.015 * amp, c.z)
  })

  const c = center.current
  return (
    <>
      <ambientLight intensity={1.05} color="#ffffff" />
      <directionalLight position={[0, 6, 1]} intensity={0.25} />
      <Framer box={box} />
      {/* pivot at the book's center so the sway rotates in place; inner group cancels the offset */}
      <group ref={pivot} position={[c.x, c.y, c.z]}>
        <group position={[-c.x, -c.y, -c.z]}>
          <Suspense fallback={null}>
            <BookViewer rightPageCanvas={right} leftPageCanvas={left} onBoundsReady={onBounds} readingMode="paper" />
          </Suspense>
        </group>
      </group>
    </>
  )
}

export function HeroBook() {
  return (
    <Canvas camera={{ fov: 45 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }} style={{ width: '100%', height: '100%' }}>
      <Scene />
    </Canvas>
  )
}
