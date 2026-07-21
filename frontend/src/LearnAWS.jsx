import { useState } from 'react'
import readoutImage from './assets/images/img1.jpg'
import dashboardImage from './assets/images/img2.jpg'

const slides = [
  {
    kicker: '01 / START HERE',
    title: <>Connect your<br /><em>AWS.</em></>,
    copy: 'Bring your cloud account into DeMarcate and turn infrastructure data into decisions you can actually act on.',
    note: 'Read-only access · Takes about 2 minutes',
    image: readoutImage,
    visual: 'account',
  },
  {
    kicker: '02 / YOUR DATA',
    title: <>See what your<br /><em>cloud knows.</em></>,
    copy: 'DeMarcate reads your EC2 footprint and recent utilization so every recommendation has context behind it.',
    note: 'CPU patterns · Instance inventory · 90-day view',
    image: dashboardImage,
    visual: 'signals',
  },
  {
    kicker: '03 / MAKE A CALL',
    title: <>Spend less.<br /><em>Stay ready.</em></>,
    copy: 'Review protected savings, understand the risk, and choose the changes that are safe for your workloads.',
    note: 'Surge guardrails · Clear next actions',
    image: readoutImage,
    visual: 'decision',
  },
]

function TutorialVisual({ slide }) {
  return (
    <div className={`tutorial-visual tutorial-visual-${slide.visual}`}>
      <img src={slide.image} alt="" />
      <div className="tutorial-visual-wash" />
      <div className="tutorial-floating-card">
        {slide.visual === 'account' && <><span>ACCOUNT STATUS</span><strong>Ready to connect</strong><small><i /> Read-only verification</small></>}
        {slide.visual === 'signals' && <><span>WORKLOAD SIGNAL</span><strong>90 days of context</strong><div className="tutorial-bars"><i /><i /><i /><i /><i /></div></>}
        {slide.visual === 'decision' && <><span>PROTECTED SAVINGS</span><strong>$15.18 <small>/ month</small></strong><small><i /> Guardrail on</small></>}
      </div>
      <div className="tutorial-orbit" />
    </div>
  )
}

function LearnAWS({ onBack, onConnect }) {
  const [slideIndex, setSlideIndex] = useState(0)
  const slide = slides[slideIndex]
  const next = () => setSlideIndex((index) => Math.min(index + 1, slides.length - 1))
  const previous = () => setSlideIndex((index) => Math.max(index - 1, 0))

  return (
    <main className="tutorial-page">
      <header className="tutorial-header">
        <button type="button" className="connect-back-button" onClick={onBack}>← <span>Back to dashboard</span></button>
        <span className="connect-page-mark">DEMARCATE / LEARN</span>
      </header>
      <section className={`tutorial-slide ${slideIndex % 2 ? 'copy-right' : 'copy-left'}`} aria-live="polite">
        <div className="tutorial-copy">
          <span className="connect-page-kicker">{slide.kicker}</span>
          <h1>{slide.title}</h1>
          <p>{slide.copy}</p>
          <div className="tutorial-note"><span /> {slide.note}</div>
          <div className="tutorial-actions">
            {slideIndex === 0 && <button type="button" className="landing-primary" onClick={onConnect}>Connect your AWS <span>→</span></button>}
            {slideIndex < slides.length - 1 ? <button type="button" className="tutorial-next" onClick={next}>Next <span>→</span></button> : <button type="button" className="landing-primary" onClick={onConnect}>Get started <span>→</span></button>}
            {slideIndex > 0 && <button type="button" className="tutorial-prev" onClick={previous}>← Back</button>}
          </div>
        </div>
        <TutorialVisual slide={slide} />
      </section>
      <footer className="tutorial-footer"><span>LEARN / CONNECT YOUR AWS</span><span>{String(slideIndex + 1).padStart(2, '0')} — {String(slides.length).padStart(2, '0')}</span></footer>
    </main>
  )
}

export default LearnAWS
