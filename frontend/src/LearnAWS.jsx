import { useState } from 'react'
import readoutImage from './assets/images/img1.jpg'
import dashboardImage from './assets/images/img2.jpg'

const slides = [
  {
    kicker: '01 / START HERE',
    title: <>Connect your<br /><em>AWS.</em></>,
    copy: 'The connection flow verifies the credentials, then starts the inventory sync without making any infrastructure changes.',
    points: ['POST /connect-aws validates access with EC2 DescribeInstances.', 'Credentials stay in server memory for the session; they are not written to SQLite or disk.', 'The response returns immediately while a background task loads inventory and CloudWatch metrics.', 'The page polls /sync-status and opens the AWS dashboard when the sync is ready.'],
    note: 'Credential validation · Background sync · No resize on connect',
    image: readoutImage,
    visual: 'account',
    visualLabel: 'CONNECTION FLOW',
    visualHeadline: 'Verified → syncing',
    visualNote: 'No infrastructure changes',
  },
  {
    kicker: '02 / INVENTORY',
    title: <>Find every<br /><em>workload.</em></>,
    copy: 'The backend discovers running EC2 instances, records their current instance types, and keeps synthetic demo workloads available when no AWS account is connected.',
    points: ['EC2 DescribeInstances is filtered to running instances.', 'The sync maps each instance ID to its actual EC2 type, up to the first 50 instances.', 'Real metrics are tagged source=real; bundled demo rows are tagged source=synthetic.', 'The /instances endpoint feeds the live inventory table.'],
    note: 'Running EC2 inventory · Real vs synthetic source labels',
    image: dashboardImage,
    visual: 'signals',
    visualLabel: 'INVENTORY',
    visualHeadline: 'Instances mapped',
    visualNote: 'Type + utilization context',
  },
  {
    kicker: '03 / METRICS',
    title: <>Turn usage into<br /><em>evidence.</em></>,
    copy: 'CloudWatch CPUUtilization is sampled as hourly averages over the latest 72 hours. Synthetic data also includes memory so the interface can demonstrate both lines.',
    points: ['Each real AWS instance gets a CloudWatch CPU query for the last 72 hours.', 'A one-hour period makes the comparison readable and reduces noisy point-to-point fluctuations.', 'Real memory is shown only when it exists; standard EC2 CPU metrics do not provide memory without an agent.', 'The metrics endpoint returns timestamp, CPU, and optional memory values to the chart.'],
    note: 'CloudWatch CPU · Hourly averages · Optional memory telemetry',
    image: readoutImage,
    visual: 'signals',
    visualLabel: 'TELEMETRY',
    visualHeadline: '72 hours of context',
    visualNote: 'CPU baseline + observed usage',
  },
  {
    kicker: '04 / RIGHTSIZE',
    title: <>Measure the<br /><em>headroom.</em></>,
    copy: 'Rightsizing is based on sustained usage, not a single low reading. DeMarcate calculates the 95th percentile CPU level and compares it with a pricing catalog.',
    points: ['p95 CPU is calculated from the stored CPU history for the instance.', 'If p95 is below 20%, the engine selects one smaller type from instance_pricing.json.', 'Monthly savings = (current hourly price − smaller hourly price) × 730 hours.', 'If the threshold is not met, the recommended type stays unchanged and the result is no_change.'],
    note: 'p95 CPU · 20% threshold · 730-hour monthly estimate',
    image: dashboardImage,
    visual: 'math',
    visualLabel: 'RIGHTSIZING ENGINE',
    visualHeadline: 'p95 < 20%',
    visualNote: 'One size down → savings estimate',
  },
  {
    kicker: '05 / SURGE PREDICTOR',
    title: <>Protect the<br /><em>next spike.</em></>,
    copy: 'A low average can be misleading when demand is about to rise. The surge predictor compares the latest three days with the instance’s historical weekday-and-hour pattern.',
    points: ['At least 21 days of hourly history are required for a meaningful comparison.', 'The baseline uses the previous 28 days, excluding the latest 72 hours.', 'A point qualifies when it is more than 40% above its expected value and at least 15 percentage points higher.', 'The largest deviation becomes a normalized surge-risk score between 0 and 1.'],
    note: '21-day minimum · 28-day pattern · 72-hour recent window',
    image: readoutImage,
    visual: 'surge',
    visualLabel: 'SURGE SIGNAL',
    visualHeadline: '+40% vs baseline',
    visualNote: 'Guardrail can pause a resize',
  },
  {
    kicker: '06 / FINAL VERDICT',
    title: <>Savings with<br /><em>judgment.</em></>,
    copy: 'The product does not present savings without context. Rightsizing and surge analysis are combined into a single decision that explains what should happen next.',
    points: ['no_change means the p95 threshold does not support a smaller type.', 'hold_off means a smaller type looked attractive, but a near-term surge signal is active.', 'safe_to_downsize means a smaller type is recommended and no surge signal is active.', 'The dashboard separates unprotected potential savings from savings currently allowed by the guardrail.'],
    note: 'Safe to downsize · Hold off · No change needed',
    image: dashboardImage,
    visual: 'decision',
    visualLabel: 'DECISION OUTPUT',
    visualHeadline: 'Context before cost',
    visualNote: 'Every recommendation has a reason',
  },
  {
    kicker: '07 / READ THE DASHBOARD',
    title: <>Make the signal<br /><em>legible.</em></>,
    copy: 'The React dashboard turns the API response into an operational readout: inventory, utilization, baseline, surge window, verdict, and savings all live together.',
    points: ['The table exposes current type, recommended type, CPU, savings, risk, and action state.', 'The detail chart overlays CPU, optional memory, and a rolling baseline.', 'A shaded SURGE WATCH area appears when the selected workload has a detected surge window.', 'The operational readout shows final protected savings and how much is deferred by the guardrail.'],
    note: 'React · Recharts · Instance-level context',
    image: readoutImage,
    visual: 'signals',
    visualLabel: 'OPERATIONAL READOUT',
    visualHeadline: 'Signal → decision',
    visualNote: 'A chart with a reason attached',
  },
  {
    kicker: '08 / DEPLOYMENT',
    title: <>From code to<br /><em>public view.</em></>,
    copy: 'The frontend and backend deploy independently so the public dashboard can live on GitHub Pages while the FastAPI service runs on Render.',
    points: ['GitHub Actions builds frontend with Vite and publishes it to GitHub Pages.', 'VITE_API_URL points the frontend at the public Render service.', 'Render runs uvicorn from backend/main.py and redeploys on pushes to main.', 'The current public Apply control is demo-only: it shows the full confirmation flow but sends no AWS mutation request.'],
    note: 'GitHub Pages · Render · Demo-safe Apply interaction',
    image: dashboardImage,
    visual: 'architecture',
    visualLabel: 'DEPLOYMENT',
    visualHeadline: 'Pages + Render',
    visualNote: 'Frontend and API connected by HTTPS',
  },
]

function TutorialVisual({ slide }) {
  return (
    <div className={`tutorial-visual tutorial-visual-${slide.visual}`}>
      <img src={slide.image} alt="" />
      <div className="tutorial-visual-wash" />
      <div className="tutorial-floating-card">
        <span>{slide.visualLabel}</span>
        <strong>{slide.visualHeadline}</strong>
        {slide.visual === 'signals' && <div className="tutorial-bars"><i /><i /><i /><i /><i /></div>}
        {slide.visual !== 'signals' && <small><i /> {slide.visualNote}</small>}
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
          <ul className="tutorial-points">{slide.points.map((point) => <li key={point}><span>·</span>{point}</li>)}</ul>
          <div className="tutorial-note"><span /> {slide.note}</div>
          <div className="tutorial-actions">
            {slideIndex === 0 && <button type="button" className="landing-primary" onClick={onConnect}>Connect your AWS <span>→</span></button>}
            {slideIndex < slides.length - 1 ? <button type="button" className="tutorial-next" onClick={next}>Next <span>→</span></button> : <button type="button" className="landing-primary" onClick={onConnect}>Get started <span>→</span></button>}
            {slideIndex > 0 && <button type="button" className="tutorial-prev" onClick={previous}>← Back</button>}
          </div>
        </div>
        <TutorialVisual slide={slide} />
      </section>
      <footer className="tutorial-footer"><span>LEARN / HOW DEMARCATE WORKS</span><span>{String(slideIndex + 1).padStart(2, '0')} — {String(slides.length).padStart(2, '0')}</span></footer>
    </main>
  )
}

export default LearnAWS
