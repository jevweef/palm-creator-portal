'use client'

export default function ContentRequestSidebar({
  title,
  dueDate,
  status,
  sections,
  templates,
  activeSection,
  expandedSections,
  onSectionClick,
  progressPercent,
}) {
  const formatDate = (d) => {
    if (!d) return ''
    const date = new Date(d + 'T00:00:00')
    return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
  }

  // Include info-only templates (like Instructions) in the sidebar
  const allSections = []
  const templatesByName = {}
  templates?.forEach(t => { templatesByName[t.name] = t })

  // Add info-only templates first (they have no items)
  templates?.forEach(t => {
    if (t.itemType === 'info_only') {
      allSections.push({ name: t.name, items: [], order: t.sortOrder, isInfoOnly: true })
    }
  })

  // Add data sections
  sections?.forEach(s => {
    allSections.push({ ...s, isInfoOnly: false })
  })

  allSections.sort((a, b) => a.order - b.order)

  return (
    <div style={{ padding: '20px 0' }}>
      {/* Title and due date */}
      <div style={{ padding: '0 20px', marginBottom: 16 }}>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a', margin: 0, lineHeight: 1.3, textTransform: 'uppercase' }}>
          {title}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          {dueDate && (
            <span style={{ fontSize: 12, color: '#888' }}>Due: {formatDate(dueDate)}</span>
          )}
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 4,
            background: status === 'Active' ? '#dcfce7' : status === 'Overdue' ? '#fef2f2' : '#f3f4f6',
            color: status === 'Active' ? '#16a34a' : status === 'Overdue' ? '#dc2626' : '#6b7280',
            textTransform: 'uppercase',
          }}>
            {status}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ padding: '0 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginBottom: 4 }}>
          <span>Progress</span>
          <span>{progressPercent}%</span>
        </div>
        <div style={{ height: 6, background: '#e5e5e5', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${progressPercent}%`,
            background: 'linear-gradient(90deg, #7c3aed, #a855f7)',
            borderRadius: 3,
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* Section list */}
      <div>
        {allSections.map((section, idx) => {
          const isActive = activeSection === section.name
          const isExpanded = expandedSections?.[section.name]
          const completed = section.items.filter(i => i.status === 'Submitted' || i.status === 'Approved').length
          const total = section.items.length
          const sectionTemplate = templatesByName[section.name]
          const sectionNumber = idx + 1

          return (
            <div key={section.name}>
              {/* Section header */}
              <button
                onClick={() => onSectionClick(section.name)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 20px',
                  background: isActive ? '#7c3aed' : 'transparent',
                  color: isActive ? '#fff' : '#333',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  textAlign: 'left',
                  transition: 'background 0.15s',
                  textTransform: 'uppercase',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, opacity: 0.7 }}>
                    {!section.isInfoOnly && (isExpanded ? '▾' : '▸')}
                  </span>
                  {sectionNumber}. {section.name}
                </span>
                {total > 0 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, opacity: 0.8 }}>{completed}/{total}</span>
                    <span style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      border: `2px solid ${isActive ? 'rgba(255,255,255,0.5)' : completed === total && total > 0 ? '#16a34a' : '#ddd'}`,
                      background: completed === total && total > 0 ? '#16a34a' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 8,
                      color: '#fff',
                    }}>
                      {completed === total && total > 0 && '✓'}
                    </span>
                  </span>
                )}
              </button>

              {/* Expanded items */}
              {isExpanded && !section.isInfoOnly && section.items.length > 0 && (
                <div style={{ background: isActive ? 'rgba(124,58,237,0.04)' : 'transparent' }}>
                  {section.items.map(item => (
                    <div
                      key={item.id}
                      style={{
                        padding: '6px 20px 6px 44px',
                        fontSize: 12,
                        color: '#666',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'default',
                      }}
                    >
                      <span style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '80%',
                      }}>
                        {item.label}
                      </span>
                      <span style={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        border: `2px solid ${
                          item.status === 'Submitted' || item.status === 'Approved' ? '#16a34a'
                          : item.status === 'Draft' ? '#eab308'
                          : item.status === 'Revision Requested' ? '#ef4444'
                          : '#ddd'
                        }`,
                        background: item.status === 'Submitted' || item.status === 'Approved' ? '#16a34a'
                          : item.status === 'Draft' ? '#eab308'
                          : item.status === 'Revision Requested' ? '#ef4444'
                          : 'transparent',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 7,
                        color: '#fff',
                      }}>
                        {(item.status === 'Submitted' || item.status === 'Approved') && '✓'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
