// The 3D reader app, on its own route. Server component (so it can export metadata) rendering the
// client <BookReader/>. The "← Home" link lives here on the page, NOT inside BookReader, so the
// standalone embed widget stays framework-agnostic.
import Link from 'next/link'
import { BookReader } from '../../components/BookReader'

export const metadata = {
  title: 'Reader',
  description: 'Open a PDF and read it on a realistic 3D book, right in your browser.',
  alternates: { canonical: '/reader' },
}

export default function ReaderPage() {
  return (
    <main style={{ width: '100vw', height: '100dvh', overflow: 'hidden', position: 'relative' }}>
      <Link
        href="/"
        aria-label="Back to home"
        style={{
          position: 'absolute', top: 12, left: 12, zIndex: 30,
          padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          fontFamily: 'sans-serif', textDecoration: 'none',
          color: '#fff', background: 'rgba(14,14,20,0.82)',
          border: '1px solid rgba(255,255,255,0.18)',
        }}
      >
        ← Home
      </Link>
      <BookReader />
    </main>
  )
}
