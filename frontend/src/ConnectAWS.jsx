import { useEffect, useState } from 'react'

const API_BASE = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8000' : '')).replace(/\/$/, '')
const API_URL = `${API_BASE}/connect-aws`

const REGIONS = [
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
  { value: 'us-west-2', label: 'US West (Oregon)' },
  { value: 'ap-south-1', label: 'Asia Pacific (Mumbai)' },
  { value: 'eu-west-1', label: 'Europe (Ireland)' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
]

function ConnectAWS({ onConnected, onBack }) {
  const [form, setForm] = useState({
    aws_access_key_id: '',
    aws_secret_access_key: '',
    aws_region: 'us-east-1',
  })
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [connectedData, setConnectedData] = useState(null)
  const [syncState, setSyncState] = useState(null)

  const updateField = (event) => {
    const { name, value } = event.target
    setForm((currentForm) => ({ ...currentForm, [name]: value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setStatus('loading')
    setMessage('')
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 60000)

    try {
      if (!API_BASE) {
        throw new Error('The production backend URL is not configured. Add VITE_API_URL to GitHub Pages and redeploy the site.')
      }

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        signal: controller.signal,
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(data.detail || 'Invalid AWS credentials, please check your access key and secret.')
        }
        throw new Error(data.detail || 'Unable to connect to AWS right now.')
      }

      setStatus('success')
      setMessage(`Connected — found ${data.instance_count ?? 0} instances`)
      setConnectedData(data)
      setSyncState({
        status: data.sync_status || 'syncing',
        instance_count: data.instance_count ?? 0,
        metrics_count: 0,
        error: null,
      })
    } catch (error) {
      setStatus('error')
      setMessage(error?.name === 'AbortError' ? 'The connection timed out. Check that the backend is running and try again.' : error instanceof Error ? error.message : 'Unable to connect to AWS right now.')
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  useEffect(() => {
    if (status !== 'success' || !connectedData || !API_BASE || syncState?.status === 'ready' || syncState?.status === 'error') return undefined

    let cancelled = false

    const pollSyncStatus = async () => {
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), 10000)

      try {
        const response = await fetch(`${API_BASE}/sync-status`, { signal: controller.signal })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.detail || 'Unable to read AWS sync status.')
        if (!cancelled) setSyncState(data)
      } catch (error) {
        if (!cancelled) {
          setSyncState((current) => ({
            ...(current || connectedData),
            status: 'error',
            error: error?.name === 'AbortError' ? 'The AWS sync status request timed out.' : 'Unable to read the AWS sync status.',
          }))
        }
      } finally {
        window.clearTimeout(timeoutId)
      }
    }

    pollSyncStatus()
    const intervalId = window.setInterval(pollSyncStatus, 2000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [connectedData, status, syncState?.status])

  const resetConnection = () => {
    setStatus('idle')
    setMessage('')
    setConnectedData(null)
    setSyncState(null)
  }

  const syncReady = syncState?.status === 'ready'
  const syncFailed = syncState?.status === 'error'

  return (
    <main className="connect-page">
      <div className="connect-page-glow" />
      <header className="connect-page-header">
        <button type="button" className="connect-back-button" onClick={onBack}>← <span>Back to dashboard</span></button>
        <span className="connect-page-mark">DEMARCATE / CONNECTION</span>
      </header>

      <section className="connect-page-layout" aria-labelledby="connect-aws-title">
        <div className="connect-page-intro">
          <span className="connect-page-kicker">AWS connection</span>
          <h1 id="connect-aws-title">Connect your<br /><em>account.</em></h1>
          <p>Bring your own AWS account into DeMarcate and see the infrastructure decisions that are ready for review.</p>
          <div className="connect-page-note"><span /> Read-only verification · No changes made to your infrastructure</div>
        </div>

        <section className={`connect-card ${status === 'success' ? 'aws-sync-card' : ''}`} aria-label={status === 'success' ? 'AWS connection results' : 'AWS credentials form'}>
          {status === 'success' ? <>
            <div className="connect-card-heading">
              <div><span>CONNECTION RESULT</span><h2>AWS account connected</h2></div>
              <span className="connect-card-status"><i className={syncReady ? 'ready' : syncFailed ? 'failed' : 'syncing'} />{syncReady ? 'Ready' : syncFailed ? 'Sync failed' : 'Syncing'}</span>
            </div>
            <div className="aws-sync-result">
              <div className={`aws-sync-icon ${syncReady ? 'ready' : syncFailed ? 'failed' : 'syncing'}`} aria-hidden="true">{syncReady ? '✓' : syncFailed ? '!' : <span />}</div>
              <span className="connect-page-kicker">AWS instance stats</span>
              <h2>{syncReady ? 'Your inventory is ready.' : syncFailed ? 'The inventory sync needs attention.' : 'Pulling your inventory.'}</h2>
              <p>{syncReady ? (syncState.metrics_count ? 'EC2 inventory and CloudWatch CPU history are ready to review.' : 'EC2 inventory is ready, but no CloudWatch CPU points were returned yet.') : syncFailed ? (syncState.error || 'Check the AWS region, IAM permissions, and Render logs.') : 'Credentials were verified. DeMarcate is now loading running EC2 instances and the last 72 hours of CPU metrics.'}</p>
              <div className="aws-sync-stats"><div><span>Running instances</span><strong>{syncState?.instance_count ?? connectedData.instance_count ?? 0}</strong></div><div><span>CPU metric points</span><strong>{syncState?.metrics_count ?? 0}</strong></div></div>
              <div className="aws-sync-progress" role="status"><span className="aws-sync-progress-dot" />{syncReady ? 'Sync complete — open the live instance dashboard.' : syncFailed ? 'Sync stopped — update permissions or try again.' : 'Syncing in the background. This page will update automatically.'}</div>
              {syncReady && <button type="button" className="aws-sync-open-button" onClick={() => onConnected?.(syncState)}>Open AWS instance stats <span>→</span></button>}
              {syncFailed && <button type="button" className="aws-sync-open-button" onClick={resetConnection}>Back to credentials <span>↺</span></button>}
              {!syncReady && !syncFailed && <button type="button" className="aws-sync-secondary-button" onClick={onBack}>Back to dashboard</button>}
            </div>
          </> : <>
          <div className="connect-card-heading">
            <div><span>VERIFY ACCESS</span><h2>Account details</h2></div>
            <span className="connect-card-status"><i /> Secure session</span>
          </div>

          <form className="connect-form" onSubmit={handleSubmit}>
            <label><span>AWS Access Key ID</span><input name="aws_access_key_id" value={form.aws_access_key_id} onChange={updateField} required autoComplete="off" placeholder="AKIA..." /></label>
            <label><span>AWS Secret Access Key</span><input type="password" name="aws_secret_access_key" value={form.aws_secret_access_key} onChange={updateField} required autoComplete="off" placeholder="Enter secret key" /></label>
            <label><span>AWS Region</span><select name="aws_region" value={form.aws_region} onChange={updateField}>{REGIONS.map((region) => <option key={region.value} value={region.value}>{region.label} · {region.value}</option>)}</select></label>
            <button type="submit" disabled={status === 'loading'}>{status === 'loading' ? 'Verifying connection...' : 'Connect to AWS'} <span>→</span></button>
          </form>

          {status === 'success' && <p role="status" className="connect-message success">{message}</p>}
          {status === 'error' && <p role="alert" className="connect-message error">{message}</p>}
          <p className="connect-privacy">Your credentials are used only for this session and are never stored.</p>
          </>}
        </section>
      </section>
    </main>
  )
}

export default ConnectAWS
