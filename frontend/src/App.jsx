import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import logo from './assets/images/logo.png'
import darkReadoutImage from './assets/images/img1.jpg'
import lightReadoutImage from './assets/images/img2.jpg'
import ConnectAWS from './ConnectAWS.jsx'
import LearnAWS from './LearnAWS.jsx'
import './index.css'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const AWS_MUTATIONS_ENABLED = import.meta.env.VITE_ENABLE_AWS_MUTATIONS === 'true'

const DEMO_ROWS = [
  {
    instance_id: 'server_6', current_type: 't3.medium', recommended_type: 't3.small',
    cpu_utilization: 92.2, p95_cpu_utilization: 18.15, estimated_monthly_savings: 15.18,
    recommendation: 'downsize', surge_risk: true, surge_risk_score: 0.94,
    insufficient_data: false, final_verdict: 'hold_off',
  },
  {
    instance_id: 'server_1', current_type: 't3.medium', recommended_type: 't3.medium',
    cpu_utilization: 13.4, p95_cpu_utilization: 21.93, estimated_monthly_savings: 0,
    recommendation: 'no_change', surge_risk: false, surge_risk_score: 0,
    insufficient_data: false, final_verdict: 'no_change',
  },
  {
    instance_id: 'server_2', current_type: 't3.medium', recommended_type: 't3.medium',
    cpu_utilization: 26.8, p95_cpu_utilization: 35.74, estimated_monthly_savings: 0,
    recommendation: 'no_change', surge_risk: false, surge_risk_score: 0,
    insufficient_data: false, final_verdict: 'no_change',
  },
  {
    instance_id: 'server_3', current_type: 't3.large', recommended_type: 't3.large',
    cpu_utilization: 43.4, p95_cpu_utilization: 52.25, estimated_monthly_savings: 0,
    recommendation: 'no_change', surge_risk: false, surge_risk_score: 0,
    insufficient_data: false, final_verdict: 'no_change',
  },
  {
    instance_id: 'server_4', current_type: 't3.large', recommended_type: 't3.large',
    cpu_utilization: 59.6, p95_cpu_utilization: 68.41, estimated_monthly_savings: 0,
    recommendation: 'no_change', surge_risk: false, surge_risk_score: 0,
    insufficient_data: false, final_verdict: 'no_change',
  },
  {
    instance_id: 'server_5', current_type: 't3.small', recommended_type: 't3.small',
    cpu_utilization: 33.6, p95_cpu_utilization: 41.99, estimated_monthly_savings: 0,
    recommendation: 'no_change', surge_risk: false, surge_risk_score: 0,
    insufficient_data: false, final_verdict: 'no_change',
  },
  {
    instance_id: 'i-009a5cba32360e562', current_type: 't3.micro', recommended_type: 't3.nano',
    cpu_utilization: 0.2, p95_cpu_utilization: 0.2, estimated_monthly_savings: 3.8,
    recommendation: 'downsize', surge_risk: false, surge_risk_score: 0,
    insufficient_data: true, final_verdict: 'safe_to_downsize',
  },
  {
    instance_id: 'i-0160c3d978af80add', current_type: 't3.micro', recommended_type: 't3.nano',
    cpu_utilization: 0.2, p95_cpu_utilization: 0.2, estimated_monthly_savings: 3.8,
    recommendation: 'downsize', surge_risk: false, surge_risk_score: 0,
    insufficient_data: true, final_verdict: 'safe_to_downsize',
  },
  {
    instance_id: 'i-08ab4da9b7626cdd0', current_type: 't3.micro', recommended_type: 't3.nano',
    cpu_utilization: 0.28, p95_cpu_utilization: 0.28, estimated_monthly_savings: 3.8,
    recommendation: 'downsize', surge_risk: false, surge_risk_score: 0,
    insufficient_data: true, final_verdict: 'safe_to_downsize',
  },
]

const SYNTHETIC_BASELINES = {
  server_1: 13, server_2: 26, server_3: 43, server_4: 59, server_5: 34, server_6: 9,
}

const SYNTHETIC_CHART_WINDOW = 72

const formatCurrency = (value) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 2,
}).format(value || 0)

const formatPercent = (value) => `${Number(value || 0).toFixed(1)}%`

async function fetchWithTimeout(url, options = {}, timeout = 6000) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeout)

  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function Icon({ name, size = 18 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    server: <><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6" /></>,
    pulse: <path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" />,
    info: <path d="M12 11v5M12 8h.01" />,
    settings: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    moon: <path d="M20.7 15.4A8.5 8.5 0 0 1 8.6 3.3 8.5 8.5 0 1 0 20.7 15.4Z" />,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    chevron: <path d="m7 10 5 5 5-5" />,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.7-4L3 10" /><path d="M3 5v5h5M4 13a8 8 0 0 0 14.7 4L21 14" /><path d="M21 19v-5h-5" /></>,
    shield: <path d="M12 3 20 6v5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6l8-3Z" />,
    trend: <><path d="M4 17 10 11l4 4 6-8" /><path d="M15 7h5v5" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>,
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

function InfoTip({ label, children, placement = 'top' }) {
  const tooltipId = useId()

  return (
    <span className={`info-tip ${placement}`}>
      <button type="button" className="info-tip-button" aria-label={label} aria-describedby={tooltipId}>
        <Icon name="info" size={11} />
      </button>
      <span id={tooltipId} className="info-tip-copy" role="tooltip">{children}</span>
    </span>
  )
}

function buildDemoMetrics(instanceId) {
  const baseline = SYNTHETIC_BASELINES[instanceId] || 0.25
  const end = new Date(Date.UTC(2026, 6, 17, 23, 0, 0))

  return Array.from({ length: 72 }, (_, index) => {
    const timestamp = new Date(end.getTime() - (71 - index) * 60 * 60 * 1000)
    const hour = timestamp.getUTCHours()
    const daytime = hour >= 9 && hour <= 18 ? Math.sin(Math.PI * (hour - 9) / 9) * 8 : 0
    const noise = Math.sin(index * 1.7) * 1.8
    const isServerSixSurge = instanceId === 'server_6' && index >= 58 && index <= 65
    const surge = isServerSixSurge ? 76 + Math.sin(((index - 58) / 7) * Math.PI) * 13 : 0
    const cpu = Math.min(98, Math.max(0.1, baseline + daytime + noise + surge))
    const memory = Math.min(98, Math.max(4, baseline + 25 + cpu * 0.32 + Math.cos(index) * 2.5))

    return {
      timestamp: timestamp.toISOString(),
      cpu_utilization: Number(cpu.toFixed(2)),
      memory_utilization: Number(memory.toFixed(2)),
    }
  })
}

function withForecast(metrics) {
  return metrics.map((point, index) => {
    const lookback = metrics.slice(Math.max(0, index - 24), index)
    const expected = lookback.length
      ? lookback.reduce((total, item) => total + Number(item.cpu_utilization || 0), 0) / lookback.length
      : Number(point.cpu_utilization || 0)

    return {
      ...point,
      label: new Date(point.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' }),
      expected_cpu: Number(expected.toFixed(2)),
    }
  })
}

function findSurgeWindow(chartData) {
  const runs = []
  let currentRun = []
  let previousIndex = -2

  chartData.forEach((point, index) => {
    const cpu = Number(point.cpu_utilization)
    const expected = Number(point.expected_cpu)
    const isSurgePoint = Number.isFinite(cpu)
      && Number.isFinite(expected)
      && cpu > expected * 1.4
      && cpu - expected >= 15

    if (isSurgePoint && index === previousIndex + 1) {
      currentRun.push(point)
    } else if (isSurgePoint) {
      if (currentRun.length) runs.push(currentRun)
      currentRun = [point]
    } else if (currentRun.length) {
      runs.push(currentRun)
      currentRun = []
    }

    if (isSurgePoint) previousIndex = index
  })

  if (currentRun.length) runs.push(currentRun)
  const largestRun = runs.sort((left, right) => right.length - left.length)[0]

  if (!largestRun) return null

  return {
    start: largestRun[0].label,
    end: largestRun[largestRun.length - 1].label,
  }
}

function riskMeta(row) {
  if (row.surge_risk) return { tone: 'red', label: 'Surge risk', icon: '🔴' }
  if (row.insufficient_data) return { tone: 'amber', label: 'Data gap', icon: '🟡' }
  if (row.recommendation === 'downsize') return { tone: 'green', label: 'Opportunity', icon: '🟢' }
  return { tone: 'green', label: 'Steady', icon: '🟢' }
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const values = payload.filter((item) => item.dataKey === 'cpu_utilization' || item.dataKey === 'memory_utilization')
  return (
    <div className="chart-tooltip">
      <span>{label}</span>
      {values.map((item) => <small key={item.dataKey} className="chart-tooltip-value"><i style={{ background: item.color }} />{item.dataKey === 'cpu_utilization' ? 'CPU' : 'Memory'} {formatPercent(item.value)}</small>)}
      {payload.find((item) => item.dataKey === 'expected_cpu') && <small>Baseline {formatPercent(payload.find((item) => item.dataKey === 'expected_cpu').value)}</small>}
    </div>
  )
}

function Reveal({ children, className = '', delay = 0 }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!('IntersectionObserver' in window)) {
      setVisible(true)
      return undefined
    }

    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting)
    }, { threshold: 0.12 })

    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  return <div ref={ref} className={`reveal ${visible ? 'is-visible' : ''} ${className}`} style={{ '--reveal-delay': `${delay}ms` }}>{children}</div>
}

function App() {
  const [rows, setRows] = useState(DEMO_ROWS)
  const [selectedId, setSelectedId] = useState('server_6')
  const [metrics, setMetrics] = useState(() => buildDemoMetrics('server_6'))
  const [guardrailEnabled] = useState(true)
  const [riskFilter, setRiskFilter] = useState('all')
  const [sortBy, setSortBy] = useState('savings')
  const [search, setSearch] = useState('')
  const [readoutLoading, setReadoutLoading] = useState(true)
  const [activeNav, setActiveNav] = useState('overview')
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [learnOpen, setLearnOpen] = useState(false)
  const [applyTarget, setApplyTarget] = useState(null)
  const [applyLoading, setApplyLoading] = useState(false)
  const [applyPopoverPosition, setApplyPopoverPosition] = useState(null)
  const [toast, setToast] = useState(null)
  const [detailPickerOpen, setDetailPickerOpen] = useState(false)
  const [metricLoading, setMetricLoading] = useState(false)
  const [metricView, setMetricView] = useState('both')
  const [darkMode, setDarkMode] = useState(() => window.localStorage.getItem('demarcate-theme') === 'dark')
  const detailPickerRef = useRef(null)
  const toastTimeoutRef = useRef(null)
  const applyAnchorRef = useRef(null)
  const dropdownCloseTimeoutRef = useRef(null)

  useEffect(() => {
    const theme = darkMode ? 'dark' : 'light'
    document.documentElement.dataset.theme = theme
    document.documentElement.style.setProperty('--page-image', `url(${darkMode ? darkReadoutImage : lightReadoutImage})`)
    window.localStorage.setItem('demarcate-theme', theme)
  }, [darkMode])

  // Give the operational readout a short first-load analysis state for the
  // dashboard's initial entry. It runs once per page load, not on navigation.
  useEffect(() => {
    const timeoutId = window.setTimeout(() => setReadoutLoading(false), 5000)
    return () => window.clearTimeout(timeoutId)
  }, [])

  const loadDashboard = useCallback(async () => {
    try {
      const [instancesResponse, recommendationsResponse] = await Promise.all([
        fetchWithTimeout(`${API_BASE}/instances`),
        fetchWithTimeout(`${API_BASE}/recommendations`),
      ])
      if (!instancesResponse.ok || !recommendationsResponse.ok) throw new Error('API unavailable')
      const [instances, recommendations] = await Promise.all([
        instancesResponse.json(), recommendationsResponse.json(),
      ])
      const instanceMap = Object.fromEntries(instances.map((instance) => [instance.instance_id, instance]))
      const nextRows = recommendations.map((recommendation) => ({
        ...recommendation,
        cpu_utilization: instanceMap[recommendation.instance_id]?.cpu_utilization ?? recommendation.p95_cpu_utilization,
      }))
      if (nextRows.length) {
        setRows(nextRows)
        setApiState('live')
      }
      return true
    } catch {
      setApiState('demo')
      return false
    }
  }, [])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  useEffect(() => {
    if (settingsOpen) return undefined

    const sections = [
      { id: 'overview', nav: 'overview' },
      { id: 'recommendations', nav: 'recommendations' },
      { id: 'instances', nav: 'instances' },
      { id: 'settings', nav: 'settings' },
    ]

    const updateActiveSection = () => {
      const scrollMarker = window.scrollY + 118
      let currentSection = 'overview'

      sections.forEach(({ id, nav }) => {
        const element = document.getElementById(id)
        if (element && element.getBoundingClientRect().top + window.scrollY <= scrollMarker) {
          currentSection = nav
        }
      })

      setActiveNav(currentSection)
    }

    updateActiveSection()
    window.addEventListener('scroll', updateActiveSection, { passive: true })
    window.addEventListener('resize', updateActiveSection)
    return () => {
      window.removeEventListener('scroll', updateActiveSection)
      window.removeEventListener('resize', updateActiveSection)
    }
  }, [settingsOpen])

  useEffect(() => {
    if (rows.length && !rows.some((row) => row.instance_id === selectedId)) {
      setSelectedId(rows[0].instance_id)
    }
  }, [rows, selectedId])

  const selected = rows.find((row) => row.instance_id === selectedId) || rows[0]

  useEffect(() => {
    if (!selected) return undefined
    let cancelled = false

    async function loadMetrics() {
      setMetricLoading(true)
      try {
        const response = await fetchWithTimeout(`${API_BASE}/instances/${selected.instance_id}/metrics`)
        if (!response.ok) throw new Error('Metrics unavailable')
        const nextMetrics = await response.json()
        if (!cancelled) setMetrics(nextMetrics.length ? nextMetrics : buildDemoMetrics(selected.instance_id))
      } catch {
        if (!cancelled) setMetrics(buildDemoMetrics(selected.instance_id))
      } finally {
        if (!cancelled) setMetricLoading(false)
      }
    }

    loadMetrics()
    return () => { cancelled = true }
  }, [selected?.instance_id])

  useEffect(() => {
    if (!detailPickerOpen) return undefined

    const closePicker = (event) => {
      if (!detailPickerRef.current?.contains(event.target)) setDetailPickerOpen(false)
    }

    document.addEventListener('mousedown', closePicker)
    return () => document.removeEventListener('mousedown', closePicker)
  }, [detailPickerOpen])

  useEffect(() => () => {
    if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current)
    if (dropdownCloseTimeoutRef.current) window.clearTimeout(dropdownCloseTimeoutRef.current)
  }, [])

  useEffect(() => {
    if (!applyTarget) return undefined

    const positionPopover = () => {
      if (!applyAnchorRef.current) return
      const bounds = applyAnchorRef.current.getBoundingClientRect()
      setApplyPopoverPosition({
        top: bounds.bottom + 10,
        right: Math.max(12, window.innerWidth - bounds.right),
      })
    }

    positionPopover()
    window.addEventListener('resize', positionPopover)
    window.addEventListener('scroll', positionPopover, true)
    return () => {
      window.removeEventListener('resize', positionPopover)
      window.removeEventListener('scroll', positionPopover, true)
    }
  }, [applyTarget])

  const chartData = useMemo(() => {
    const isSynthetic = selected?.instance_id?.startsWith('server_')
    const visibleMetrics = isSynthetic && metrics.length > SYNTHETIC_CHART_WINDOW
      ? metrics.slice(-SYNTHETIC_CHART_WINDOW)
      : metrics
    return withForecast(visibleMetrics)
  }, [metrics, selected?.instance_id])
  const surgeWindow = useMemo(() => findSurgeWindow(chartData), [chartData])
  const memoryAvailable = chartData.some((point) => point.memory_utilization !== null && point.memory_utilization !== undefined && Number.isFinite(Number(point.memory_utilization)))

  useEffect(() => {
    if (!memoryAvailable) setMetricView('cpu')
    else if (metricView === 'cpu' && chartData.every((point) => point.memory_utilization === null || point.memory_utilization === undefined)) setMetricView('both')
  }, [memoryAvailable, chartData, metricView])

  const filteredRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      const meta = riskMeta(row)
      const matchesSearch = row.instance_id.toLowerCase().includes(search.toLowerCase())
      const matchesRisk = riskFilter === 'all' || meta.tone === riskFilter
      return matchesSearch && matchesRisk
    })

    return filtered.sort((a, b) => {
      if (sortBy === 'risk') return Number(b.surge_risk) - Number(a.surge_risk)
      if (sortBy === 'cpu') return Number(b.cpu_utilization) - Number(a.cpu_utilization)
      return Number(b.estimated_monthly_savings || 0) - Number(a.estimated_monthly_savings || 0)
    })
  }, [rows, riskFilter, search, sortBy])

  const effectiveVerdict = (row) => {
    if (!guardrailEnabled && row.recommendation === 'downsize') return 'safe_to_downsize'
    return row.final_verdict || (row.recommendation === 'downsize' ? 'safe_to_downsize' : 'no_change')
  }

  const totalPotentialSavings = rows.reduce((total, row) => {
    return total + (effectiveVerdict(row) === 'safe_to_downsize' ? Number(row.estimated_monthly_savings || 0) : 0)
  }, 0)
  const totalUnprotectedSavings = rows.reduce((total, row) => {
    return total + (row.recommendation === 'downsize' ? Number(row.estimated_monthly_savings || 0) : 0)
  }, 0)
  const deferredSavings = Math.max(0, totalUnprotectedSavings - totalPotentialSavings)
  const highRiskCount = rows.filter((row) => row.surge_risk).length
  const resizeCount = rows.filter((row) => row.recommendation === 'downsize').length
  const selectedVerdict = selected?.surge_risk ? 'surge-risk' : selected ? effectiveVerdict(selected).replaceAll('_', '-') : 'no-change'
  const selectedVerdictLabel = selected?.surge_risk ? 'surge risk' : selected ? effectiveVerdict(selected).replaceAll('_', ' ') : 'no change'

  const handleNav = (section) => {
    if (dropdownCloseTimeoutRef.current) window.clearTimeout(dropdownCloseTimeoutRef.current)
    setActiveNav(section)
    setMenuOpen(false)
    setSettingsOpen(false)
    document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const keepDropdownOpen = () => {
    if (dropdownCloseTimeoutRef.current) window.clearTimeout(dropdownCloseTimeoutRef.current)
  }

  const closeDropdownSoon = () => {
    if (dropdownCloseTimeoutRef.current) window.clearTimeout(dropdownCloseTimeoutRef.current)
    dropdownCloseTimeoutRef.current = window.setTimeout(() => {
      setMenuOpen(false)
      setSettingsOpen(false)
    }, 180)
  }

  const openRecommendationsMenu = () => {
    keepDropdownOpen()
    setActiveNav('recommendations')
    setSettingsOpen(false)
    setMenuOpen(true)
  }

  const openSettingsMenu = () => {
    keepDropdownOpen()
    setActiveNav('settings')
    setMenuOpen(false)
    setSettingsOpen(true)
  }

  const openConnectPage = () => {
    setMenuOpen(false)
    setSettingsOpen(false)
    setConnectOpen(true)
  }

  const openLearnPage = () => {
    setMenuOpen(false)
    setSettingsOpen(false)
    setLearnOpen(true)
  }

  const showToast = (type, message) => {
    if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current)
    setToast({ type, message })
    toastTimeoutRef.current = window.setTimeout(() => setToast(null), 7000)
  }

  const confirmApply = async () => {
    if (!applyTarget || applyLoading) return

    setApplyLoading(true)
    try {
      const response = await fetchWithTimeout(
        `${API_BASE}/apply-recommendation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instance_id: applyTarget.instance_id }),
        },
        12 * 60 * 1000,
      )
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const detail = typeof data.detail === 'string' ? data.detail : 'The resize could not be applied.'
        throw new Error(detail)
      }

      await loadDashboard()
      setApplyTarget(null)
      setApplyPopoverPosition(null)
      showToast('success', `✅ ${data.instance_id} resized from ${data.old_type} to ${data.new_type}`)
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'The resize could not be applied.')
    } finally {
      setApplyLoading(false)
    }
  }

  const openApplyPopover = (event, row) => {
    event.stopPropagation()
    applyAnchorRef.current = event.currentTarget
    const bounds = event.currentTarget.getBoundingClientRect()
    setApplyPopoverPosition({
      top: bounds.bottom + 10,
      right: Math.max(12, window.innerWidth - bounds.right),
    })
    setApplyTarget(row)
  }

  const handleAWSConnected = async () => {
    setApiState('live')
    await loadDashboard()
    setConnectOpen(false)
  }

  const popoverPosition = applyPopoverPosition || { top: 110, right: 20 }

  if (connectOpen) {
    return <ConnectAWS onBack={() => setConnectOpen(false)} onConnected={handleAWSConnected} />
  }

  if (learnOpen) {
    return <LearnAWS onBack={() => setLearnOpen(false)} onConnect={() => { setLearnOpen(false); setConnectOpen(true) }} />
  }

  return (
    <div className="app-shell">
      {toast && <div className={`apply-toast ${toast.type}`} role="status"><span>{toast.message}</span><button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification">×</button></div>}
      <header className="headbar">
        <div className="headbar-inner">
          <a className="header-pill brand-pill h-12 px-4 rounded-[56px]" href="#overview" onClick={() => handleNav('overview')}>
            <img src={logo} alt="" />
            <span>DeMarcate</span>
          </a>

          <nav className="header-pill nav-pill h-12 rounded-[56px]" aria-label="Primary navigation">
            <button className={`nav-item ${activeNav === 'overview' ? 'active' : ''}`} onClick={() => handleNav('overview')}>Overview</button>
            <button className={`nav-item ${activeNav === 'instances' ? 'active' : ''}`} onClick={() => handleNav('instances')}>Instances</button>
            <button className={`nav-item nav-menu-item ${menuOpen ? 'active' : ''}`} aria-expanded={menuOpen} onMouseEnter={openRecommendationsMenu} onMouseLeave={closeDropdownSoon} onFocus={openRecommendationsMenu} onClick={() => { openRecommendationsMenu(); document.getElementById('recommendations')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>Recommendations <Icon name="chevron" size={14} /></button>
          </nav>

          <div className="header-pill actions-pill h-12 rounded-[56px]">
            <button className={`settings-icon-button rounded-[12px] ${settingsOpen ? 'active' : ''}`} aria-label="Open settings" title="Settings" aria-expanded={settingsOpen} onMouseEnter={openSettingsMenu} onMouseLeave={closeDropdownSoon} onFocus={openSettingsMenu} onClick={() => { keepDropdownOpen(); setMenuOpen(false); setSettingsOpen((value) => !value) }}><Icon name="settings" size={18} /></button>
            <button className="connect-button rounded-[56px]" onClick={openConnectPage}>Connect AWS <Icon name="arrow" size={14} /></button>
          </div>
        </div>

        {menuOpen && <div className="mega-menu" role="dialog" aria-label="Recommendation navigation" onMouseEnter={keepDropdownOpen} onMouseLeave={closeDropdownSoon}>
          <div className="mega-column"><span>Monitor</span><button onClick={() => handleNav('instances')}>Instance inventory</button><button onClick={() => handleNav('instances')}>Utilization trends</button><button onClick={() => handleNav('instances')}>CPU baselines</button></div>
          <div className="mega-column"><span>Learn</span><button onClick={openLearnPage}>Connect your AWS</button><button onClick={openLearnPage}>How DeMarcate works</button><button onClick={openLearnPage}>Read the signal</button></div>
          <div className="mega-column"><span>Next action</span><button onClick={() => handleNav('recommendations')}>Review protected savings <Icon name="arrow" size={14} /></button><small>{formatCurrency(totalPotentialSavings)} ready to act on</small></div>
        </div>}

        {settingsOpen && <div className="settings-menu" role="dialog" aria-label="Settings menu" onMouseEnter={keepDropdownOpen} onMouseLeave={closeDropdownSoon}>
          <div className="settings-heading"><span>Settings</span><small>Appearance</small></div>
          <button type="button" className="settings-connect-row" onClick={openConnectPage}><span className="settings-connect-icon">↗</span><span><b>Connect AWS</b><small>Use your own account</small></span></button>
          <button className="settings-theme-row" onClick={() => setDarkMode((value) => !value)} aria-pressed={darkMode}>
            <span className="settings-theme-icon"><Icon name={darkMode ? 'sun' : 'moon'} size={16} /></span>
            <span><b>{darkMode ? 'Light mode' : 'Dark mode'}</b><small>{darkMode ? 'Use the warm interface' : 'Use the dark interface'}</small></span>
            <span className={`settings-switch ${darkMode ? 'on' : ''}`}><i /></span>
          </button>
        </div>}
      </header>

      {applyTarget && createPortal(<section
        className="apply-popover"
        style={{ top: `${popoverPosition.top}px`, right: `${popoverPosition.right}px` }}
        role="dialog"
        aria-modal="false"
        aria-labelledby="apply-popover-title"
      >
        <div className="apply-popover-header">
          <div>
            <span>Resize guardrail</span>
            <h2 id="apply-popover-title">Apply recommendation?</h2>
          </div>
          <span className="apply-popover-badge">AWS / EC2</span>
        </div>
        <p className="apply-popover-copy">This will briefly stop and restart <strong>{applyTarget.instance_id}</strong> to change it from <strong>{applyTarget.current_type}</strong> to <strong>{applyTarget.recommended_type}</strong>. The instance will be unavailable for about 1-2 minutes during this process. Continue?</p>
        {applyLoading && <div className="apply-popover-progress"><span className="apply-spinner" /><span>In progress, this takes a minute. AWS is waiting for the instance state to change.</span></div>}
        <div className="apply-popover-actions">
          <button type="button" disabled={applyLoading} onClick={() => { setApplyTarget(null); setApplyPopoverPosition(null) }}>Cancel</button>
          <button type="button" disabled={applyLoading} onClick={confirmApply}>{applyLoading ? 'Applying resize...' : 'Confirm Apply'}</button>
        </div>
      </section>, document.body)}

      <main className="main-panel" id="overview">

        <div className="content-wrap">
          <Reveal delay={40}>
          <section className="landing-hero">
            <div className="landing-copy">
              <h1>Spend less.<br /><span>Stay ready.</span></h1>
              <p>See where your cloud spend can shrink — without trading away the headroom your workloads need.</p>
              <div className="landing-actions">
                <button className="landing-primary" onClick={() => handleNav('instances')}>Review instances <Icon name="arrow" size={15} /></button>
              </div>
              <div className="landing-meta"><span className="status-dot" /> <span>{rows.length} instances monitored</span><b>·</b><span>90 days of telemetry</span></div>
            </div>
            <div className="hero-readout" id="recommendations">
              <div className="readout-content">
                <div className="readout-topline"><span>Operational readout</span><span>Today, 14:32 IST</span></div>
                <div className={`readout-main ${readoutLoading ? 'is-loading' : 'is-ready'}`}><span>Protected monthly savings</span><strong className="readout-price saved-price" aria-live="polite">{readoutLoading ? <span className="price-skeleton-bar" aria-label="Calculating savings" /> : `−${formatCurrency(totalPotentialSavings)}`}</strong><p>{readoutLoading ? 'Analyzing telemetry and surge context' : 'With DeMarcate'}</p></div>
                <div className="readout-grid"><div><span className="metric-label">Recommendations <InfoTip label="What are recommendations?" placement="bottom-right">Recommendations that are currently safe to apply under DeMarcate's surge guardrail.</InfoTip></span><b>{resizeCount}</b></div><div><span className="metric-label">Surge signals <InfoTip label="What are surge signals?" placement="bottom">Instances whose recent CPU usage is running significantly above their historical baseline.</InfoTip></span><b>{highRiskCount}</b></div><div><span className="metric-label">Confidence <InfoTip label="How is confidence calculated?" placement="bottom-left">A combined read of CPU p95, telemetry coverage, and near-term surge context.</InfoTip></span><b>94%</b></div></div>
                <div className="scenario-control">
                  <div className="scenario-label"><span>Decision comparison <InfoTip label="What is Decision comparison?">Compares potential savings if surge risk is ignored with the savings DeMarcate allows after its guardrail.</InfoTip></span><b>Before / after</b></div>
                  <div className={`comparison-values ${readoutLoading ? 'is-loading' : 'is-ready'}`}><div className="before-price"><small>Before guardrail</small>{readoutLoading ? <span className="price-skeleton-small" aria-label="Loading before price" /> : <strong>{formatCurrency(totalUnprotectedSavings)}</strong>}</div><span>→</span><div className="after-price"><small>After guardrail</small>{readoutLoading ? <span className="price-skeleton-small" aria-label="Loading after price" /> : <><strong>{formatCurrency(deferredSavings)}</strong>{guardrailEnabled && totalPotentialSavings > 0 && <small className="reduction-value">−{formatCurrency(totalPotentialSavings)} reduced</small>}</>}</div></div>
                </div>
              </div>
            </div>
          </section>
          </Reveal>

          <Reveal delay={120}>
          <section className="stat-grid" aria-label="Workspace summary">
            <article className="stat-card"><div className="stat-icon lavender"><Icon name="server" /></div><span className="metric-label">Instances monitored <InfoTip label="What are monitored instances?">The total number of synthetic and real AWS workloads currently visible to DeMarcate.</InfoTip></span><strong>{rows.length}</strong><small><i className="up-arrow">↑</i> All telemetry connected</small></article>
            <article className="stat-card"><div className="stat-icon green"><Icon name="trend" /></div><span className="metric-label">Resize opportunities <InfoTip label="What are resize opportunities?">Instances with enough evidence that a smaller instance type could reduce monthly cost.</InfoTip></span><strong>{resizeCount}</strong><small>Across current footprint</small></article>
            <article className="stat-card"><div className="stat-icon red"><Icon name="shield" /></div><span className="metric-label">Surge signals <InfoTip label="What are surge signals?">Recent CPU behavior that is unusually high compared with the workload's historical pattern.</InfoTip></span><strong>{highRiskCount}</strong><small>{highRiskCount ? 'Guardrail active' : 'No active warnings'}</small></article>
            <article className="stat-card accent-card"><span className="metric-label">Decision confidence <InfoTip label="What is Decision confidence?"><span className="confidence-formula-copy">The confidence score is a weighted average of three signals:<span className="confidence-formula">C = 100 × (0.50C<sub>CPU</sub> + 0.30C<sub>telemetry</sub> + 0.20C<sub>surge</sub>)</span><span className="confidence-formula">C<sub>CPU</sub> = 1 − p95(CPU) / 100</span><span className="confidence-formula">C<sub>telemetry</sub> = observed samples / expected samples</span><span className="confidence-formula">C<sub>surge</sub> = 1 − surge-risk rate</span>Each component is capped to [0, 1], and C is rounded to the nearest whole percent.</span></InfoTip></span><strong>94<small>%</small></strong><div className="confidence-bar"><span /></div><small>Based on CPU p95 + surge context</small></article>
          </section>
          </Reveal>

          <Reveal delay={160}>
          <section className="work-grid">
            <div className="instances-card panel-card" id="instances">
              <div className="panel-heading">
                <div><div className="section-kicker">LIVE INVENTORY</div><h2>Instances</h2><p>Every recommendation, with its context attached.</p></div>
                <button className="ghost-button" onClick={() => { setSearch(''); setRiskFilter('all'); handleNav('instances') }}>View all <Icon name="arrow" size={15} /></button>
              </div>
              <div className="table-toolbar">
                <label className="search-box"><Icon name="search" size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search instances..." /></label>
                <div className="toolbar-selects"><label><span>Risk</span><select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}><option value="all">All levels</option><option value="red">High risk</option><option value="amber">Watch / gap</option><option value="green">Opportunity</option></select></label><label><span>Sort</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="savings">Savings</option><option value="risk">Risk level</option><option value="cpu">Utilization</option></select></label></div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Instance</th><th>Current type</th><th>Utilization</th><th>Recommendation</th><th>Est. savings</th><th>Risk</th><th>Action</th></tr></thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const meta = riskMeta(row)
                      const verdict = effectiveVerdict(row)
                      const savings = verdict === 'safe_to_downsize' ? row.estimated_monthly_savings : 0
                      return (
                        <tr key={row.instance_id} className={row.instance_id === selected?.instance_id ? 'selected-row' : ''} onClick={() => setSelectedId(row.instance_id)}>
                          <td><div className="instance-cell"><span className={`instance-signal ${meta.tone}`} /><div><b>{row.instance_id}</b><small>{row.instance_id.startsWith('i-') ? 'AWS / EC2' : 'Synthetic workload'}</small></div></div></td>
                          <td><code>{row.current_type}</code></td>
                          <td><div className="util-cell"><span>{formatPercent(row.cpu_utilization)}</span><div className="mini-bar"><i style={{ width: `${Math.min(Number(row.cpu_utilization || 0), 100)}%` }} /></div></div></td>
                          <td><div className="recommendation-cell"><code>{row.recommended_type}</code>{row.recommendation === 'downsize' && <span className={verdict === 'hold_off' && guardrailEnabled ? 'hold-label' : 'resize-label'}>{verdict === 'hold_off' && guardrailEnabled ? 'hold' : 'resize'}</span>}</div></td>
                          <td><strong className={savings ? 'savings-value' : 'muted-value'}>{savings ? `+${formatCurrency(savings)}` : '—'}</strong></td>
                          <td><span className={`risk-badge ${meta.tone}`}><span className="risk-dot" aria-hidden="true" />{meta.label}</span></td>
                          <td><div className="table-actions">{AWS_MUTATIONS_ENABLED && row.final_verdict === 'safe_to_downsize' && <button type="button" className="apply-row-button" disabled={applyLoading} onClick={(event) => { event.preventDefault(); openApplyPopover(event, row) }}>Apply</button>}<button type="button" className="row-arrow" aria-label={`Open ${row.instance_id}`}><Icon name="arrow" size={15} /></button></div></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {!filteredRows.length && <div className="empty-state">No instances match these filters.</div>}
              </div>
              <div className="table-footer"><span>Showing {filteredRows.length} of {rows.length} instances</span><span><span className="footer-dot" /> Telemetry refreshes every 5 min</span></div>
            </div>

            <aside className="detail-card panel-card">
              {selected && <>
                <div className="detail-topline">
                  <div className="detail-identity">
                    <div className="detail-picker" ref={detailPickerRef}>
                      <button type="button" className="detail-picker-button" onClick={() => setDetailPickerOpen((value) => !value)} aria-expanded={detailPickerOpen} aria-haspopup="listbox">
                        <span><small>INSTANCE DETAIL</small><strong>{selected.instance_id}</strong></span>
                        <Icon name="chevron" size={16} />
                      </button>
                      {detailPickerOpen && <>
                        <button type="button" className="detail-picker-scrim" aria-label="Close instance selector" onClick={() => setDetailPickerOpen(false)} />
                        <aside className="detail-picker-menu" role="dialog" aria-label="Select an instance">
                          <div className="detail-picker-menu-header"><div><small>WORKLOADS</small><h3>Select an instance</h3><p>{rows.length} monitored workloads</p></div><button type="button" onClick={() => setDetailPickerOpen(false)} aria-label="Close instance selector">×</button></div>
                          <div className="detail-picker-list" role="listbox">
                            {rows.map((row) => {
                              const meta = riskMeta(row)
                              return <button type="button" role="option" aria-selected={row.instance_id === selected.instance_id} className={`detail-picker-option ${row.instance_id === selected.instance_id ? 'selected' : ''}`} key={row.instance_id} onClick={() => { setSelectedId(row.instance_id); setDetailPickerOpen(false) }}>
                                <span className="detail-picker-option-main"><strong>{row.instance_id}</strong><small>{row.current_type} · CPU {formatPercent(row.cpu_utilization)}</small></span>
                                <span className="detail-picker-option-meta"><small><span className={`risk-dot ${meta.tone}`} aria-hidden="true" />{meta.label}</small><small>{row.estimated_monthly_savings ? formatCurrency(row.estimated_monthly_savings) : 'No savings'}</small></span>
                              </button>
                            })}
                          </div>
                        </aside>
                      </>}
                    </div>
                    <p><span className="live-dot" /> {selected.instance_id.startsWith('i-') ? 'AWS EC2 · Mumbai' : 'Synthetic workload · test data'}</p>
                  </div>
                  <span className={`verdict-badge ${selectedVerdict}`} role="status" aria-label={`Verdict: ${selectedVerdictLabel}`}>{selectedVerdictLabel}</span>
                </div>
                <div className="detail-stats"><div><span className="metric-label">Current CPU <InfoTip label="What is Current CPU?" placement="bottom-right">The latest CPU utilization value available for this instance.</InfoTip></span><strong>{formatPercent(selected.cpu_utilization)}</strong></div><div><span className="metric-label">CPU p95 <InfoTip label="What is CPU p95?" placement="bottom">The CPU level that this instance stayed below for 95% of the observed history. It helps show sustained peak demand.</InfoTip></span><strong>{formatPercent(selected.p95_cpu_utilization)}</strong></div><div><span className="metric-label">Est. savings <InfoTip label="How are estimated savings calculated?" placement="bottom-left">The approximate monthly difference between the current and recommended instance types, using 730 hours per month.</InfoTip></span><strong>{formatCurrency(selected.estimated_monthly_savings)}</strong></div></div>
                <div className="chart-heading"><div><h3>Utilization</h3><span>Last 72 hours · hourly average</span></div><div className="chart-controls"><div className="metric-toggle" role="group" aria-label="Metric visibility">{[['cpu', 'CPU only'], ['memory', 'Memory only'], ['both', 'Both']].map(([value, label]) => <button type="button" key={value} className={metricView === value ? 'active' : ''} disabled={value === 'memory' && !memoryAvailable} onClick={() => setMetricView(value)}>{label}</button>)}</div><div className="chart-legend"><span><i className="legend-line cpu-line" /> CPU</span>{memoryAvailable && <span><i className="legend-line memory-line" /> Memory</span>}<span><i className="legend-line baseline" /> Baseline</span></div></div></div>
                <div className="chart-wrap">
                  {metricLoading ? <div className="chart-loading"><span />Loading telemetry</div> : <ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 12, right: 8, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--chart-text)', fontSize: 10 }} interval={Math.max(1, Math.floor(chartData.length / 5))} />
                    <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: 'var(--chart-text)', fontSize: 10 }} tickFormatter={(value) => `${value}%`} />
                    <Tooltip content={<ChartTooltip />} />
                    <ReferenceLine y={20} stroke="var(--warning)" strokeDasharray="4 4" label={{ value: 'watch', position: 'insideTopRight', fill: 'var(--warning)', fontSize: 10 }} />
                    {selected.surge_risk && surgeWindow && <ReferenceArea x1={surgeWindow.start} x2={surgeWindow.end} fill="var(--danger)" fillOpacity={0.08} label={{ value: 'SURGE WATCH', position: 'insideTopLeft', fill: 'var(--danger)', fontSize: 9 }} />}
                    {(metricView === 'cpu' || metricView === 'both') && <Line type="monotone" dataKey="expected_cpu" stroke="var(--chart-baseline)" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />}
                    {(metricView === 'cpu' || metricView === 'both') && <Line type="monotone" dataKey="cpu_utilization" name="CPU" stroke="var(--chart-accent)" strokeWidth={2.5} dot={false} connectNulls activeDot={{ r: 4, fill: 'var(--chart-accent)', stroke: 'var(--bg)' }} />}
                    {memoryAvailable && (metricView === 'memory' || metricView === 'both') && <Line type="monotone" dataKey="memory_utilization" name="Memory" stroke="var(--chart-memory)" strokeWidth={2.5} dot={false} connectNulls activeDot={{ r: 4, fill: 'var(--chart-memory)', stroke: 'var(--bg)' }} />}
                  </LineChart></ResponsiveContainer>}
                </div>
                {!memoryAvailable && <p className="memory-unavailable-note">Memory data unavailable — CloudWatch agent not installed on this instance</p>}
                <div className={`decision-callout ${selected.surge_risk && guardrailEnabled ? 'danger' : 'positive'}`}><div className="callout-icon"><Icon name={selected.surge_risk && guardrailEnabled ? 'shield' : 'trend'} size={17} /></div><div><strong>{selected.surge_risk && guardrailEnabled ? 'Guardrail engaged' : effectiveVerdict(selected) === 'safe_to_downsize' ? 'Ready for rightsize' : 'Keep current capacity'}</strong><p>{selected.surge_risk && guardrailEnabled ? 'Recent traffic is running above its historical baseline. Hold the resize until the signal clears.' : effectiveVerdict(selected) === 'safe_to_downsize' ? 'Low utilization and no active surge signal. This change is safe to schedule.' : 'Current utilization supports keeping this capacity for now.'}</p></div></div>
              </>}
            </aside>
          </section>
          </Reveal>

          <footer className="app-footer" id="settings"><span><b>DeMarcate</b> · Infrastructure decisions, made legible.</span><span>Built for safer savings <Icon name="shield" size={13} /></span></footer>
        </div>
      </main>
    </div>
  )
}

export default App
