import { useState } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'
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

  const updateField = (event) => {
    const { name, value } = event.target
    setForm((currentForm) => ({ ...currentForm, [name]: value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setStatus('loading')
    setMessage('')
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 10000)

    try {
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
      onConnected?.(data)
    } catch (error) {
      setStatus('error')
      setMessage(error?.name === 'AbortError' ? 'The connection timed out. Check that the backend is running and try again.' : error instanceof Error ? error.message : 'Unable to connect to AWS right now.')
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

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

        <section className="connect-card" aria-label="AWS credentials form">
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
        </section>
      </section>
    </main>
  )
}

export default ConnectAWS
