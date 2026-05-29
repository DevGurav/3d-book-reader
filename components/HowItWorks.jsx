'use client'
// "How it works" as a connected reading-timeline: when it scrolls into view, an accent line draws
// left→right across the three steps, a book glides along it, and each step badge lights up in turn.
import { useEffect, useRef, useState } from 'react'
import styles from './Landing.module.css'

const STEPS = [
  { n: '1', title: 'Open the reader', body: 'Click “Open Reader” — it loads instantly in your browser.' },
  { n: '2', title: 'Choose a PDF', body: 'Hit “Open PDF” and pick any file from your device.' },
  { n: '3', title: 'Read in 3D', body: 'Flip through the spread, zoom into a section, or switch reading modes.' },
]

export function HowItWorks() {
  const ref = useRef(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true)
          io.disconnect()
        }
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section className={styles.section}>
      <h2 className={styles.h2}>How it works</h2>
      <div ref={ref} className={`${styles.flow} ${active ? styles.flowActive : ''}`}>
        <div className={styles.flowTrack}>
          <span className={styles.flowFill} />
        </div>
        <span className={styles.flowMarker} aria-hidden="true">📖</span>
        <div className={styles.flowSteps}>
          {STEPS.map((s) => (
            <div key={s.n} className={styles.flowStep}>
              <div className={styles.stepNum}>{s.n}</div>
              <h3 className={styles.cardTitle}>{s.title}</h3>
              <p className={styles.cardBody}>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
