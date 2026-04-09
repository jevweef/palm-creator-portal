'use client'

import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/nextjs'
import { usePathname, useSearchParams } from 'next/navigation'
import ContentRequestSidebar from '@/components/content-request/ContentRequestSidebar'
import ContentRequestSection from '@/components/content-request/ContentRequestSection'
import ContentRequestItem from '@/components/content-request/ContentRequestItem'

export default function ContentRequestPage() {
  const { user, isLoaded } = useUser()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeSection, setActiveSection] = useState(null)
  const [expandedSections, setExpandedSections] = useState({})

  // If viewing as creator (/creator/[id]/content-request), use that ID
  const creatorIdFromPath = pathname?.startsWith('/creator/') ? pathname.split('/')[2] : null
  const opsId = creatorIdFromPath || user?.publicMetadata?.airtableOpsId
  const hqId = searchParams?.get('hqId') || user?.publicMetadata?.airtableHqId

  const fetchData = useCallback(async () => {
    if (!isLoaded) return // Wait for Clerk to load
    if (!opsId) {
      setLoading(false)
      return
    }
    try {
      const res = await fetch(`/api/content-request?creatorOpsId=${opsId}`)
      if (!res.ok) throw new Error('Failed to fetch content request')
      const json = await res.json()
      setData(json)
      if (json.sections?.length && !activeSection) {
        setActiveSection(json.sections[0].name)
        setExpandedSections(prev => ({ ...prev, [json.sections[0].name]: true }))
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [opsId, isLoaded, activeSection])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleSectionClick = (sectionName) => {
    setActiveSection(sectionName)
    setExpandedSections(prev => ({ ...prev, [sectionName]: !prev[sectionName] }))
  }

  const handleItemUpdate = (itemId, updates) => {
    setData(prev => {
      if (!prev) return prev
      const newSections = prev.sections.map(section => ({
        ...section,
        items: section.items.map(item => {
          const virtualKey = `${item._section}|${item.itemOrder}`
          if (item.id === itemId || virtualKey === itemId) {
            return { ...item, ...updates }
          }
          return item
        }),
      }))
      return { ...prev, sections: newSections }
    })
  }

  // Navigation: prev/next section
  const sectionNames = data?.sections?.map(s => s.name) || []
  const currentIdx = sectionNames.indexOf(activeSection)
  const prevSection = currentIdx > 0 ? sectionNames[currentIdx - 1] : null
  const nextSection = currentIdx < sectionNames.length - 1 ? sectionNames[currentIdx + 1] : null

  // Find template info for active section
  const activeTemplate = data?.templates?.find(t => t.name === activeSection)
  const activeSectionData = data?.sections?.find(s => s.name === activeSection)

  // Calculate overall progress
  const totalItems = data?.sections?.reduce((sum, s) => sum + s.items.length, 0) || 0
  const completedItems = data?.sections?.reduce(
    (sum, s) => sum + s.items.filter(i => i.status === 'Submitted' || i.status === 'Approved').length,
    0
  ) || 0
  const progressPercent = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', color: '#999' }}>
          <div style={{ width: 32, height: 32, border: '3px solid #e5e5e5', borderTopColor: '#7c3aed', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
          Loading content request...
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#ef4444' }}>
        Error: {error}
      </div>
    )
  }

  if (!data?.request) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8, color: '#1a1a1a' }}>No Active Content Request</h2>
        <p style={{ color: '#999' }}>You don&apos;t have an active content request right now. Check back later!</p>
      </div>
    )
  }

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        .cr-layout { display: flex; min-height: calc(100vh - 56px); }
        .cr-sidebar { width: 320px; min-width: 320px; background: #fafafa; border-right: 1px solid #eee; overflow-y: auto; }
        .cr-main { flex: 1; overflow-y: auto; padding: 0; background: #f5f5f5; }
        .cr-main-inner { max-width: 800px; margin: 0 auto; padding: 24px 32px 60px; }
        @media (max-width: 900px) {
          .cr-layout { flex-direction: column; }
          .cr-sidebar { width: 100%; min-width: 100%; max-height: 280px; border-right: none; border-bottom: 1px solid #eee; }
          .cr-main-inner { padding: 16px; }
        }
      `}</style>
      <div className="cr-layout">
        <div className="cr-sidebar">
          <ContentRequestSidebar
            title={data.request.title}
            dueDate={data.request.dueDate}
            status={data.request.status}
            sections={data.sections}
            templates={data.templates}
            activeSection={activeSection}
            expandedSections={expandedSections}
            onSectionClick={handleSectionClick}
            progressPercent={progressPercent}
          />
        </div>
        <div className="cr-main">
          {/* Prev / Next navigation */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 32px', borderBottom: '1px solid #eee', background: '#fff', fontSize: 13, color: '#888' }}>
            <button
              onClick={() => prevSection && handleSectionClick(prevSection)}
              disabled={!prevSection}
              style={{ background: 'none', border: 'none', cursor: prevSection ? 'pointer' : 'default', color: prevSection ? '#7c3aed' : '#ccc', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              {prevSection && <>&#8249; {prevSection}</>}
            </button>
            <button
              onClick={() => nextSection && handleSectionClick(nextSection)}
              disabled={!nextSection}
              style={{ background: 'none', border: 'none', cursor: nextSection ? 'pointer' : 'default', color: nextSection ? '#7c3aed' : '#ccc', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              {nextSection && <>{nextSection} &#8250;</>}
            </button>
          </div>

          <div className="cr-main-inner">
            {/* Section description card */}
            {activeTemplate && (
              <ContentRequestSection
                name={activeTemplate.name}
                description={activeTemplate.description}
                itemCount={activeTemplate.itemCount}
                itemType={activeTemplate.itemType}
              />
            )}

            {/* Individual upload items */}
            {activeSectionData?.items.map((item, idx) => (
              <ContentRequestItem
                key={item.id || `${item._section}-${item.itemOrder}`}
                item={item}
                hqId={hqId}
                onUpdate={handleItemUpdate}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
