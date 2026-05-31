// Marketing landing page (server component — fully server-rendered for SEO). The hero shows the real
// 3D book live (<HeroBook>, client); sections animate in on scroll (<Reveal>, client). Sends visitors
// into the reader at /reader. Styling lives in Landing.module.css.
import Link from 'next/link'
import styles from './Landing.module.css'
import { HeroBook } from './HeroBook'
import { HowItWorks } from './HowItWorks'
import { ScrollProgress } from './ScrollProgress'
import { Reveal } from './Reveal'
import paperShot from '../assets/paper-mode.png'
import sepiaShot from '../assets/sepia-mode.png'
import nightShot from '../assets/night-mode.png'
import reflowShot from '../assets/reflow-mode.png'
import dictionaryShot from '../assets/dictionary-lookup-mode.png'
import ttsShot from '../assets/text-to-speech-mode.png'

const FEATURES = [
  { icon: '📖', title: 'A real 3D book', body: 'Your PDF is painted onto a true two-page spread you can rotate, tilt and orbit.' },
  { icon: '🔍', title: 'Zoom into anything', body: 'Scroll to zoom toward the cursor — pages re-render at higher resolution so text stays crisp.' },
  { icon: '🎨', title: 'Reading modes', body: 'Paper, Sepia and Night, each with matched background and lighting for comfortable reading.' },
  { icon: '♿', title: 'Reflow for accessibility', body: 'Re-typeset the text with adjustable font size, line spacing and weight — great for low vision.' },
  { icon: '📄', title: 'Any PDF', body: 'Open any PDF from your device. No conversion, no sign-up, no limits.' },
  { icon: '🔒', title: '100% private', body: 'Everything runs in your browser. Your file is never uploaded to any server.' },
]

const MODES = [
  { src: paperShot.src, label: 'Paper' },
  { src: sepiaShot.src, label: 'Sepia' },
  { src: nightShot.src, label: 'Night' },
  { src: reflowShot.src, label: 'Reflow' },
  { src: dictionaryShot.src, label: 'Dictionary' },
  { src: ttsShot.src, label: 'Text to speech' },
]

export function Landing() {
  return (
    <div className={styles.page}>
      <ScrollProgress />
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.wordmark}>Bookie<span className={styles.accent}>3D</span></div>
        <Link href="/reader" className={styles.navCta}>Open Reader →</Link>
      </header>

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.heroText}>
          <h1 className={styles.h1}>
            Read any PDF on a <span className={styles.highlight}>realistic 3D book</span>
          </h1>
          <p className={styles.sub}>
            A tactile, two-page reading experience right in your browser — zoom into any section,
            switch reading modes, and reflow the text for comfort. Free, and nothing is ever uploaded.
          </p>
          <div className={styles.heroBtns}>
            <Link href="/reader" className={styles.primaryBtn}>Open Reader →</Link>
            <a href="#features" className={styles.ghostBtn}>See features</a>
          </div>
          <p className={styles.note}>No sign-up · Works with any PDF · 100% client-side</p>
        </div>
        <div className={styles.heroArt}>
          <div className={styles.heroGlow} aria-hidden="true" />
          <div className={styles.heroCanvas}>
            <HeroBook />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className={styles.section}>
        <Reveal as="h2" className={styles.h2}>Everything you need to read comfortably</Reveal>
        <div className={styles.featureGrid}>
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 70}>
              <div className={styles.card}>
                <div className={styles.cardIcon} aria-hidden="true">{f.icon}</div>
                <h3 className={styles.cardTitle}>{f.title}</h3>
                <p className={styles.cardBody}>{f.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Reading modes showcase */}
      <section className={styles.section}>
        <Reveal as="h2" className={styles.h2}>Modes &amp; reading tools</Reveal>
        <Reveal as="p" className={styles.sectionSub}>Paper, Sepia and Night themes — plus Reflow, Dictionary lookup and Text&#8209;to&#8209;speech.</Reveal>
        <div className={styles.shots}>
          {MODES.map((m, i) => (
            <Reveal key={m.label} delay={i * 90}>
              <figure className={styles.shot}>
                <div className={styles.shotFrame}>
                  <img src={m.src} alt={`${m.label} reading mode`} className={styles.shotImg} />
                </div>
                <figcaption className={styles.shotCap}>{m.label}</figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Reading quote */}
      <section className={styles.quoteBand}>
        <Reveal as="blockquote" className={styles.quote}>
          “A reader lives a thousand lives before he dies.”
          <cite className={styles.quoteCite}>— George R.R. Martin</cite>
        </Reveal>
      </section>

      {/* How it works — animated reading timeline */}
      <HowItWorks />

      {/* Final CTA */}
      <section className={styles.ctaBand}>
        <Reveal as="h2" className={styles.h2}>Ready to read?</Reveal>
        <Reveal as="p" className={styles.sectionSub} delay={80}>Open the reader and drop in your first PDF.</Reveal>
        <Reveal delay={160}>
          <Link href="/reader" className={styles.primaryBtn}>Open Reader →</Link>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <span className={styles.wordmark}>Bookie<span className={styles.accent}>3D</span></span>
        <span className={styles.footNote}>© {new Date().getFullYear()} · Read any PDF on a 3D book, in your browser.</span>
      </footer>
    </div>
  )
}
