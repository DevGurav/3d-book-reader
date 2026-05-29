'use client'
// A thin "reading progress" bar pinned to the top of the page — fills as you scroll, like a
// progress indicator on a reading site. Purely decorative; reflects how far down the page you are.
import { useEffect, useState } from 'react'

export function ScrollProgress() {
  const [pct, setPct] = useState(0)

  useEffect(() => {
    const update = () => {
      const el = document.documentElement
      const max = el.scrollHeight - el.clientHeight
      setPct(max > 0 ? Math.min(100, (el.scrollTop / max) * 100) : 0)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed', top: 0, left: 0, zIndex: 60,
        height: 3, width: `${pct}%`,
        background: 'linear-gradient(90deg, #e8a838, #f4c66b)',
        boxShadow: '0 0 10px rgba(232,168,56,0.6)',
        transition: 'width 0.08s linear',
      }}
    />
  )
}
