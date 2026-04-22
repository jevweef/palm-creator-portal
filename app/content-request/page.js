'use client'

import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/nextjs'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import ContentRequestSectionCard from '@/components/content-request/ContentRequestSectionCard'

export default function ContentRequestPage() {
  const { user, isLoaded } = useUser()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [creators, setCreators] = useState([])
  const [loadingCreators, setLoadingCreators] = useState(false)

  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin'
  const creatorIdFromPath = pathname?.startsWith('/creator/') ? pathname.split('/')[2] : null
  const opsId = creatorIdFromPath || user?.publicMetadata?.airtableOpsId
  const hqId = searchParams?.get('hqId') || user?.publicMetadata?.airtableHqId

  // Fetch creator list for admin picker
  useEffect(() => {
    if (!isLoaded || !isAdmin || opsId) return
    setLoadingCreators(true)
    fetch('/api/admin/palm-creators')
      .then(r => r.json())
      .then(d => setCreators(d.creators || []))
      .catch(() => {})
      .finally(() => setLoadingCreators(false))
  }, [isLoaded, isAdmin, opsId])

  const fetchData = useCallback(async () => {
    if (!isLoaded) return
    if (!opsId) { setLoading(false); return }
    try {
      const res = await fetch(`/api/content-request?creatorOpsId=${opsId}`)
      if (!res.ok) throw new Error('Failed to fetch content request')
      setData(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [opsId, isLoaded])

  useEffect(() => { fetchData() }, [fetchData])

  const handleFilesUploaded = (sectionName, newFiles) => {
    setData(prev => {
      if (!prev) return prev
      return {
        ...prev,
        sections: prev.sections.map(s =>
          s.name === sectionName
            ? { ...s, files: [...s.files, ...newFiles], uploadedCount: s.uploadedCount + newFiles.length }
            : s
        ),
      }
    })
  }

  const totalMin = data?.sections?.reduce((sum, s) => sum + s.minCount, 0) || 0
  const totalUploaded = data?.sections?.reduce((sum, s) => sum + s.uploadedCount, 0) || 0
  const progressPercent = totalMin > 0 ? Math.min(100, Math.round((totalUploaded / totalMin) * 100)) : 0

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', color: '#999' }}>
          <div style={{ width: 32, height: 32, border: '3px solid #F0D0D8', borderTopColor: '#E88FAC', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
          Loading content request...
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (error) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#ef4444' }}>Error: {error}</div>
  }

  // Admin with no creator selected — show picker
  if (!opsId && isAdmin) {
    return (
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '60px 20px' }}>
        <div style={{
          background: 'var(--card-bg-solid)',
          borderRadius: 18,
          padding: '32px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          textAlign: 'center',
        }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a', margin: '0 0 8px 0' }}>
            Content Requests
          </h2>
          <p style={{ color: '#888', fontSize: 14, margin: '0 0 24px 0' }}>
            Select a creator to view their content request
          </p>
          {loadingCreators ? (
            <div style={{ color: '#999', fontSize: 13 }}>Loading creators...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {creators.map(c => (
                <button
                  key={c.id}
                  onClick={() => router.push(`/creator/${c.id}/content-request?hqId=${c.hqId || ''}`)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 20px',
                    background: 'var(--background)',
                    border: '1px solid transparent',
                    borderRadius: 10,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    fontSize: 14,
                    fontWeight: 500,
                    color: '#1a1a1a',
                    textAlign: 'left',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#E88FAC'; e.currentTarget.style.background = '#FFF0F3' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = '#FFF5F7' }}
                >
                  <span>{c.aka || c.name}</span>
                  <span style={{ color: '#E88FAC', fontSize: 13 }}>View &rarr;</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!data?.sections?.length) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8, color: '#1a1a1a' }}>No Active Content Request</h2>
        <p style={{ color: '#999' }}>You don&apos;t have an active content request right now. Check back later!</p>
      </div>
    )
  }

  const month = data.request?.month || new Date().toISOString().slice(0, 7)
  const formatDate = (d) => {
    if (!d) return ''
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 20px 80px' }}>
      {/* Header */}
      <div style={{
        background: 'var(--card-bg-solid)',
        borderRadius: 18,
        padding: '24px 32px',
        marginBottom: 24,
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a', margin: '0 0 6px 0' }}>
              {data.request?.title || 'Content Request'}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: '#888' }}>
              {data.request?.dueDate && <span>Due: {formatDate(data.request.dueDate)}</span>}
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 10px',
                borderRadius: 4,
                background: '#dcfce7',
                color: '#16a34a',
                textTransform: 'uppercase',
              }}>
                {data.request?.status || 'Active'}
              </span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: progressPercent >= 100 ? '#16a34a' : '#1a1a1a' }}>
              {progressPercent}%
            </div>
            <div style={{ fontSize: 11, color: '#999' }}>
              {totalUploaded} of {totalMin} files
            </div>
          </div>
        </div>

        {/* Overall progress bar */}
        <div style={{ height: 8, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden', marginTop: 16 }}>
          <div style={{
            height: '100%',
            width: `${progressPercent}%`,
            background: progressPercent >= 100 ? '#16a34a' : 'linear-gradient(90deg, #E88FAC, #d4789a)',
            borderRadius: 4,
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* Section cards */}
      {data.sections.map(section => (
        <ContentRequestSectionCard
          key={section.name}
          section={section}
          hqId={hqId}
          requestId={data.request?.id}
          creatorOpsId={opsId}
          month={month}
          onFilesUploaded={handleFilesUploaded}
        />
      ))}
    </div>
  )
}
