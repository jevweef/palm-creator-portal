'use client'

import { useState, useEffect, useCallback } from 'react'

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: '#111',
      border: '1px solid #222',
      borderRadius: '10px',
      padding: '20px',
      flex: '1 1 0',
      minWidth: '140px',
    }}>
      <div style={{ fontSize: '11px', color: '#71717a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
        {label}
      </div>
      <div style={{ fontSize: '28px', fontWeight: 700, color: color || 'var(--foreground)' }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: '12px', color: '#71717a', marginTop: '4px' }}>{sub}</div>
      )}
    </div>
  )
}

function ActionButton({ label, description, onClick, loading, result, color = '#A78BFA' }) {
  return (
    <div style={{
      background: '#111',
      border: '1px solid #222',
      borderRadius: '10px',
      padding: '20px',
      flex: '1 1 0',
      minWidth: '200px',
    }}>
      <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '12px', color: '#71717a', marginBottom: '16px' }}>{description}</div>
      <button
        onClick={onClick}
        disabled={loading}
        style={{
          background: loading ? '#333' : color,
          color: 'var(--foreground)',
          border: 'none',
          borderRadius: '6px',
          padding: '8px 20px',
          fontSize: '13px',
          fontWeight: 600,
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.6 : 1,
          transition: 'opacity 0.15s',
          width: '100%',
        }}
      >
        {loading ? 'Running...' : `Run ${label}`}
      </button>
      {result && (
        <div style={{
          marginTop: '10px',
          padding: '8px 12px',
          background: result.error ? '#2d1515' : '#152d15',
          border: `1px solid ${result.error ? '#5c2020' : '#205c20'}`,
          borderRadius: '6px',
          fontSize: '12px',
          color: result.error ? '#ff8888' : '#88ff88',
        }}>
          {result.error || result.message}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status, count }) {
  const colors = {
    'Ready for Analysis': '#78B4E8',
    'Processing': '#E8C878',
    'Complete': '#A78BFA',
    'Reviewed': '#7DD3A4',
    'Error': '#E87878',
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: colors[status] || 'rgba(240, 236, 232, 0.85)' }} />
        <span style={{ fontSize: '13px', color: '#d4d4d8' }}>{status}</span>
      </div>
      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)' }}>{count}</span>
    </div>
  )
}

export default function AdminPipeline() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [scrapeLoading, setScrapeLoading] = useState(false)
  const [scrapeResult, setScrapeResult] = useState(null)
  const [promoteLoading, setPromoteLoading] = useState(false)
  const [promoteResult, setPromoteResult] = useState(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisResult, setAnalysisResult] = useState(null)

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/pipeline-status')
      if (!res.ok) throw new Error('Failed to fetch')
      setStats(await res.json())
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])

  const runScrape = async () => {
    setScrapeLoading(true)
    setScrapeResult(null)
    try {
      const res = await fetch('/api/admin/scrape', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scrape failed')
      setScrapeResult({ message: `Started ${data.started?.length || 0} source(s). ${data.skipped?.length || 0} skipped (cooldown).` })
      setTimeout(fetchStats, 3000)
    } catch (err) {
      setScrapeResult({ error: err.message })
    } finally {
      setScrapeLoading(false)
    }
  }

  const runPromote = async () => {
    setPromoteLoading(true)
    setPromoteResult(null)
    try {
      const res = await fetch('/api/admin/promote', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Promotion failed')
      setPromoteResult({ message: data.message || `Promoted ${data.promoted || 0} reels.` })
      setTimeout(fetchStats, 2000)
    } catch (err) {
      setPromoteResult({ error: err.message })
    } finally {
      setPromoteLoading(false)
    }
  }

  const runAnalysis = async () => {
    setAnalysisLoading(true)
    setAnalysisResult(null)
    try {
      const res = await fetch('/api/admin/trigger-analysis', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Trigger failed')
      setAnalysisResult({ message: data.message || 'Analysis triggered.' })
    } catch (err) {
      setAnalysisResult({ error: err.message })
    } finally {
      setAnalysisLoading(false)
    }
  }

  const formatTime = (ts) => {
    if (!ts) return 'Never'
    try {
      const d = new Date(ts)
      const now = new Date()
      const diffH = Math.round((now - d) / 3600000)
      if (diffH < 1) return 'Just now'
      if (diffH < 24) return `${diffH}h ago`
      return `${Math.round(diffH / 24)}d ago`
    } catch { return ts }
  }

  if (loading) {
    return <div style={{ color: 'rgba(240, 236, 232, 0.85)', fontSize: '14px', padding: '40px' }}>Loading pipeline status...</div>
  }

  const statusOrder = ['Ready for Analysis', 'Processing', 'Complete', 'Reviewed', 'Error']

  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--foreground)', marginBottom: '24px' }}>
        Pipeline Control Center
      </h1>

      {/* Stats Row */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <StatCard
          label="Model Accounts"
          value={`${stats?.sources?.enabled || 0} / ${stats?.sources?.total || 0}`}
          sub={`Last scraped ${formatTime(stats?.sources?.lastScrape)}`}
        />
        <StatCard
          label="Scraped Reels"
          value={stats?.sourceReels?.total?.toLocaleString() || '0'}
          sub={`${stats?.sourceReels?.byDataSource?.Apify || 0} Apify · ${stats?.sourceReels?.byDataSource?.RapidAPI || 0} RapidAPI · ${(stats?.sourceReels?.byDataSource?.Manual || 0) + (stats?.sourceReels?.byDataSource?.['IG Export'] || 0)} manual`}
        />
        <StatCard
          label="Inspo Board"
          value={(stats?.inspiration?.byStatus?.['Complete'] || 0).toLocaleString()}
          sub={`${stats?.inspiration?.byStatus?.['Ready for Analysis'] || 0} queued for analysis · ${stats?.inspiration?.total || 0} total in pipeline`}
          color="#a78bfa"
        />
        {(stats?.sourceReels?.reviewQueue > 0) && (
          <StatCard
            label="Review Queue"
            value={stats.sourceReels.reviewQueue}
            sub="reels waiting for your review"
            color="#f59e0b"
          />
        )}
      </div>

      {/* Status Breakdown */}
      <div style={{
        background: '#111',
        border: '1px solid #222',
        borderRadius: '10px',
        padding: '20px',
        marginBottom: '24px',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '12px' }}>
          Inspo Board Breakdown
        </div>
        {statusOrder.map(status => {
          const count = stats?.inspiration?.byStatus?.[status]
          if (!count) return null
          return <StatusBadge key={status} status={status} count={count} />
        })}
        {/* Show any other statuses not in the order */}
        {Object.entries(stats?.inspiration?.byStatus || {})
          .filter(([s]) => !statusOrder.includes(s))
          .map(([status, count]) => (
            <StatusBadge key={status} status={status} count={count} />
          ))}
      </div>

      {/* Action Buttons */}
      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '12px' }}>
        Pipeline Actions
      </div>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <ActionButton
          label="Scrape"
          description="Pull latest reels from all active model accounts into Source Reels."
          onClick={runScrape}
          loading={scrapeLoading}
          result={scrapeResult}
          color="#3b82f6"
        />
        <ActionButton
          label="Promote"
          description="Score scraped reels and push top performers to the Inspo Board."
          onClick={runPromote}
          loading={promoteLoading}
          result={promoteResult}
          color="#a78bfa"
        />
        <ActionButton
          label="Analysis"
          description="Run AI analysis on promoted reels — generates tags, directions, and notes."
          onClick={runAnalysis}
          loading={analysisLoading}
          result={analysisResult}
          color="#22c55e"
        />
      </div>
    </div>
  )
}
