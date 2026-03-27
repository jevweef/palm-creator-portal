'use client'

import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/nextjs'

import InspoCard from '@/components/InspoCard'
import InspoModal from '@/components/InspoModal'
import { tagStyle } from '@/lib/tagStyle'

function computeGradeFn(records) {
  const scores = records.map((r) => r.engagementScore || 0).sort((a, b) => a - b)
  const n = scores.length
  return function getGrade(score) {
    if (n === 0) return null
    const s = score || 0
    // bisect to find rank
    let lo = 0, hi = n
    while (lo < hi) { const mid = (lo + hi) >> 1; if (scores[mid] <= s) lo = mid + 1; else hi = mid }
    const pct = lo / n
    if (pct >= 0.95) return 'A+'
    if (pct >= 0.85) return 'A'
    if (pct >= 0.75) return 'A-'
    if (pct >= 0.65) return 'B+'
    if (pct >= 0.55) return 'B'
    if (pct >= 0.45) return 'B-'
    if (pct >= 0.35) return 'C+'
    if (pct >= 0.25) return 'C'
    if (pct >= 0.15) return 'C-'
    return 'D'
  }
}

export function gradeColor(grade) {
  if (!grade) return '#52525b'
  if (grade === 'A+') return '#ffd700'
  if (grade.startsWith('A')) return '#4ade80'
  if (grade.startsWith('B')) return '#60a5fa'
  if (grade.startsWith('C')) return '#fb923c'
  return '#71717a'
}

const PINNED_TAGS = [
  'Thirst Trap',
  'Soft Tease',
  'Implied Scenario',
  'POV / Personal Attention',
  'Body Focus',
  'Outfit Showcase',
  'Domestic / At-Home',
  'Mirror Moment',
  'Funny',
  'Eye Contact Driven',
]

const CATEGORY_ORDER = ['Setting', 'Niche Identity', 'Vibe / Personality', 'Subject / Body', 'Scenario', 'Other']
const TAG_CATEGORY_MAP = {
  'Artsy / Creative Girl':      'Setting',
  'Beach Girl':                 'Setting',
  'City Girl':                  'Setting',
  'Domestic / At-Home':         'Setting',
  'Kitchen / Food Content':     'Setting',
  'Luxury / Elevated Lifestyle':'Setting',
  'Mirror Moment':              'Setting',
  'Nature / Outdoors':          'Setting',
  'Travel / Adventure':         'Setting',
  'Bikini / Swim':              'Niche Identity',
  'Bookish / Smart Girl':       'Niche Identity',
  'Fitness':                    'Niche Identity',
  'Fitness / Wellness':         'Niche Identity',
  'Glam / Beauty':              'Niche Identity',
  'Musician / Singer':          'Niche Identity',
  'Tattoos':                    'Niche Identity',
  'Bratty / Mischievous':       'Vibe / Personality',
  'Cute / Sweet Vibe':          'Vibe / Personality',
  'Direct Flirt':               'Vibe / Personality',
  'Dominant Energy':            'Vibe / Personality',
  'Girlfriend Vibe':            'Vibe / Personality',
  'Girl Next Door':             'Vibe / Personality',
  'Lifestyle Casual':           'Vibe / Personality',
  'Playful Personality':        'Vibe / Personality',
  'Soft Tease':                 'Vibe / Personality',
  'Submissive / Shy Energy':    'Vibe / Personality',
  'Toxic':                      'Vibe / Personality',
  'Funny':                      'Vibe / Personality',
  'Wifey':                      'Vibe / Personality',
  'Body Focus':                 'Subject / Body',
  'Boobs':                      'Subject / Body',
  'Booty':                      'Subject / Body',
  'Face Card / Pretty Girl':    'Subject / Body',
  'Feet':                       'Subject / Body',
  'Foot Fetish':                'Subject / Body',
  'Lingerie / Sleepwear':       'Subject / Body',
  'Outfit Showcase':            'Subject / Body',
  'Thirst Trap':                'Subject / Body',
  'Suggestive Movement':        'Subject / Body',
  'Eye Contact Driven':         'Scenario',
  'POV / Personal Attention':   'Scenario',
  'Personal Attention':         'Scenario',
  'POV':                        'Scenario',
  'Roleplay':                   'Scenario',
  'Implied Scenario':           'Scenario',
  'Dance':                      'Other',
  'Lipsync':                    'Other',
  'Lip Sync':                   'Other',
  'Car Content':                'Other',
  'Young':                      'Other',
  'Viral Cut-In':               'Other',
  'Audio-Led':                  'Other',
  'Clapback':                   'Other',
}

function groupTags(allTags) {
  const groups = {}
  CATEGORY_ORDER.forEach((cat) => { groups[cat] = [] })
  allTags.forEach((tag) => {
    const cat = TAG_CATEGORY_MAP[tag] || 'Other'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(tag)
  })
  return CATEGORY_ORDER
    .filter((cat) => groups[cat]?.length > 0)
    .map((cat) => ({ label: cat, tags: groups[cat] }))
}

function TagPill({ tag, active, onClick, size = 'sm' }) {
  const ts = tagStyle(tag)
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: size === 'sm' ? '11px' : '12px',
        padding: size === 'sm' ? '3px 8px' : '4px 10px',
        borderRadius: '9999px',
        whiteSpace: 'nowrap',
        border: 'none',
        cursor: 'pointer',
        fontWeight: active ? 700 : 400,
        transition: 'all 0.15s',
        background: active ? ts.color : ts.background,
        color: active ? '#000' : ts.color,
        outline: active ? `2px solid ${ts.color}` : 'none',
        outlineOffset: active ? '1px' : '0',
        opacity: active ? 1 : 0.8,
      }}
    >
      {tag}
    </button>
  )
}

export default function InspoBoard() {
  const { user } = useUser()
  const [records, setRecords] = useState([])
  const [filtered, setFiltered] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selectedIdx, setSelectedIdx] = useState(null)
  const [activeTags, setActiveTags] = useState([])
  const [activeFormats, setActiveFormats] = useState([])
  const [tagMode, setTagMode] = useState('any')
  const [showMobileFilters, setShowMobileFilters] = useState(false)
  const [sort, setSort] = useState('recent') // 'top' | 'recent' | 'viral'
  const [search, setSearch] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [allTags, setAllTags] = useState([])
  const [allFormats, setAllFormats] = useState([])
  const [savedIds, setSavedIds] = useState(new Set())

  const creatorOpsId = user?.publicMetadata?.airtableOpsId || 'recFusZAbRapOGblK' // Default: Grace Collins

  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        const res = await fetch('/api/inspiration')
        if (!res.ok) throw new Error('Failed to load')
        const data = await res.json()
        setRecords(data.records)

        const tagSet = new Set()
        const fmtSet = new Set()
        data.records.forEach((r) => {
          r.tags.forEach((t) => tagSet.add(t))
          r.filmFormat.forEach((f) => fmtSet.add(f))
        })
        setAllTags(Array.from(tagSet).sort())
        setAllFormats(Array.from(fmtSet).sort())

        // Initialize saved state from records
        const saved = new Set()
        data.records.forEach((r) => {
          if (r.savedBy && r.savedBy.includes(creatorOpsId)) saved.add(r.id)
        })
        setSavedIds(saved)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleSave = useCallback(async (recordId) => {
    const isSaved = savedIds.has(recordId)
    const action = isSaved ? 'unsave' : 'save'

    // Optimistic update
    setSavedIds((prev) => {
      const next = new Set(prev)
      if (isSaved) next.delete(recordId)
      else next.add(recordId)
      return next
    })

    try {
      const res = await fetch('/api/inspo-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId, creatorOpsId, action }),
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        console.error(`[Save] Failed: ${res.status} ${res.statusText}`, errText)
        alert(`Save failed ${res.status}: ${errText.slice(0, 300)}`)
        // Revert on failure
        setSavedIds((prev) => {
          const next = new Set(prev)
          if (isSaved) next.add(recordId)
          else next.delete(recordId)
          return next
        })
      }
    } catch (err) {
      console.error('[Save] Exception:', err)
      alert(`Save error: ${err.message}`)
      // Revert on failure
      setSavedIds((prev) => {
        const next = new Set(prev)
        if (isSaved) next.add(recordId)
        else next.delete(recordId)
        return next
      })
    }
  }, [savedIds, creatorOpsId])

  useEffect(() => {
    let result = [...records]

    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter((r) =>
        r.title.toLowerCase().includes(q) ||
        r.username.toLowerCase().includes(q) ||
        r.onScreenText.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
      )
    }

    if (activeTags.length > 0) {
      if (tagMode === 'all') {
        result = result.filter((r) =>
          activeTags.every((t) => r.tags.includes(t) || r.suggestedTags.includes(t))
        )
      } else {
        result = result.filter((r) =>
          activeTags.some((t) => r.tags.includes(t) || r.suggestedTags.includes(t))
        )
      }
    }

    if (activeFormats.length > 0) {
      result = result.filter((r) =>
        activeFormats.some((f) => r.filmFormat.includes(f))
      )
    }

    // Sort
    if (sort === 'top') {
      result.sort((a, b) => (b.engagementScore || 0) - (a.engagementScore || 0))
    } else if (sort === 'viral') {
      result.sort((a, b) => (b.views || 0) - (a.views || 0))
    } else if (sort === 'recent') {
      result.sort((a, b) => new Date(b.creatorPostedDate || 0) - new Date(a.creatorPostedDate || 0))
    }

    setFiltered(result)
  }, [records, search, activeTags, activeFormats, tagMode, sort])

  const toggleTag = (tag) => setActiveTags((prev) =>
    prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
  )
  const toggleFormat = (fmt) => setActiveFormats((prev) =>
    prev.includes(fmt) ? prev.filter((f) => f !== fmt) : [...prev, fmt]
  )
  const clearAll = () => { setActiveTags([]); setActiveFormats([]); setSearch(''); setTagMode('any'); setSort('top') }

  const openModal = (idx) => setSelectedIdx(idx)
  const closeModal = () => setSelectedIdx(null)
  const goPrev = useCallback(() => setSelectedIdx((i) => (i > 0 ? i - 1 : i)), [])
  const goNext = useCallback(() => setSelectedIdx((i) => (i < filtered.length - 1 ? i + 1 : i)), [filtered.length])

  const tagGroups = groupTags(allTags)
  const pinnedAvailable = PINNED_TAGS.filter((t) => allTags.includes(t))
  const hasActiveFilters = activeTags.length > 0 || activeFormats.length > 0
  const getGrade = records.length > 0 ? computeGradeFn(records) : () => null

  const SortBtn = ({ value, label }) => (
    <button
      onClick={() => setSort(value)}
      style={{
        fontSize: '13px',
        padding: '5px 14px',
        borderRadius: '9999px',
        border: 'none',
        cursor: 'pointer',
        fontWeight: sort === value ? 600 : 400,
        background: sort === value ? '#fff' : 'transparent',
        color: sort === value ? '#000' : '#71717a',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur border-b border-[#1a1a1a]">
        <div style={{maxWidth:'1400px', margin:'0 auto', padding:'12px 32px'}}>

          {/* Mobile: title + filter button */}
          <div className="flex md:hidden items-center justify-between">
            <div>
              <h1 style={{fontSize:'16px', fontWeight:700, color:'#fff', margin:0}}>Inspo Board</h1>
              {!loading && (
                <p style={{fontSize:'11px', color:'#52525b', marginTop:'1px'}}>{filtered.length} reels</p>
              )}
            </div>
            <button
              onClick={() => setShowMobileFilters(true)}
              style={{
                display:'flex', alignItems:'center', gap:'6px',
                background:'#111', border:'1px solid #222', borderRadius:'9999px',
                padding:'7px 14px', fontSize:'12px', fontWeight:500, color:'#d4d4d8', cursor:'pointer',
              }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Sort & Filter
              {(activeTags.length + activeFormats.length) > 0 && (
                <span style={{background:'#a855f7', color:'#fff', borderRadius:'9999px', fontSize:'9px', fontWeight:700, padding:'1px 6px'}}>
                  {activeTags.length + activeFormats.length}
                </span>
              )}
            </button>
          </div>

          {/* Desktop: single row — sort + tags + search — NO wrap */}
          <div className="hidden md:flex items-center gap-2" style={{flexWrap:'nowrap'}}>
            {/* Sort toggle */}
            <div style={{display:'flex', alignItems:'center', background:'#111', border:'1px solid #222', borderRadius:'9999px', padding:'2px', gap:'1px', flexShrink:0}}>
              <SortBtn value="top" label="Top" />
              <SortBtn value="viral" label="Viral" />
              <SortBtn value="recent" label="Recent" />
            </div>

            {/* Divider */}
            <div style={{width:'1px', height:'20px', background:'#27272a', flexShrink:0}} />

            {/* Tag pills — scroll horizontally if needed */}
            <div style={{display:'flex', gap:'6px', overflowX:'auto', flexShrink:1, minWidth:0, scrollbarWidth:'none', msOverflowStyle:'none', WebkitOverflowScrolling:'touch'}}>
              {pinnedAvailable.map((tag) => (
                <TagPill key={tag} tag={tag} active={activeTags.includes(tag)} onClick={() => toggleTag(tag)} />
              ))}
            </div>

            {/* + Filters button */}
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              style={{
                fontSize:'11px', padding:'3px 10px', borderRadius:'9999px', border:'1px solid #2a2a2a',
                cursor:'pointer', background: showAdvanced ? '#27272a' : 'transparent',
                color: showAdvanced ? '#fff' : '#71717a',
                display:'flex', alignItems:'center', gap:'4px', transition:'all 0.15s', flexShrink:0, whiteSpace:'nowrap',
              }}
            >
              {showAdvanced ? '▲' : '▼'} {showAdvanced ? 'Less' : 'More'} filters
              {(activeTags.filter(t => !PINNED_TAGS.includes(t)).length + activeFormats.length) > 0 && (
                <span style={{background:'#fff', color:'#000', borderRadius:'9999px', fontSize:'9px', fontWeight:700, padding:'0 5px', marginLeft:'2px'}}>
                  {activeTags.filter(t => !PINNED_TAGS.includes(t)).length + activeFormats.length}
                </span>
              )}
            </button>

            {/* ANY/ALL — only when 2+ tags */}
            {activeTags.length >= 2 && (
              <div style={{display:'flex', alignItems:'center', background:'#111', border:'1px solid #222', borderRadius:'9999px', padding:'2px', flexShrink:0}}>
                {['any','all'].map((m) => (
                  <button key={m} onClick={() => setTagMode(m)} style={{
                    fontSize:'11px', fontWeight:500, padding:'3px 10px', borderRadius:'9999px', border:'none', cursor:'pointer',
                    background: tagMode === m ? '#fff' : 'transparent',
                    color: tagMode === m ? '#000' : '#71717a',
                    transition:'all 0.15s',
                  }}>
                    {m === 'any' ? 'Match ANY' : 'Match ALL'}
                  </button>
                ))}
              </div>
            )}

            {/* Clear all — only when filters active */}
            {hasActiveFilters && (
              <button onClick={clearAll} style={{fontSize:'11px', color:'#52525b', background:'none', border:'none', cursor:'pointer', textDecoration:'underline', flexShrink:0, whiteSpace:'nowrap'}}>
                Clear all
              </button>
            )}

            {/* Spacer to push search right */}
            <div style={{flex:1}} />

            {/* Reel count */}
            {!loading && (
              <span style={{fontSize:'11px', color:'#52525b'}}>{filtered.length} reels</span>
            )}

            {/* Search */}
            <div style={{position:'relative'}}>
              <svg style={{position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', width:'13px', height:'13px', color:'#52525b'}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width:'200px', background:'#111', border:'1px solid #222', borderRadius:'8px',
                  paddingLeft:'30px', paddingRight:'12px', paddingTop:'6px', paddingBottom:'6px',
                  fontSize:'13px', color:'#fff', outline:'none',
                }}
              />
            </div>
          </div>

          {/* Advanced panel */}
          {showAdvanced && (
            <div style={{marginTop:'10px', paddingTop:'10px', borderTop:'1px solid #1a1a1a'}}>
              {tagGroups.map((group, gi) => (
                <div key={group.label} style={{display:'flex', alignItems:'center', gap:'8px', marginBottom: gi < tagGroups.length - 1 ? '6px' : '0'}}>
                  <span style={{fontSize:'9px', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'#52525b', whiteSpace:'nowrap', width:'80px', flexShrink:0, textAlign:'right'}}>
                    {group.label}
                  </span>
                  <div style={{width:'1px', height:'14px', background:'#27272a', flexShrink:0}} />
                  <div style={{display:'flex', gap:'5px', flexWrap:'wrap'}}>
                    {group.tags.map((tag) => (
                      <TagPill key={tag} tag={tag} active={activeTags.includes(tag)} onClick={() => toggleTag(tag)} />
                    ))}
                  </div>
                </div>
              ))}

              {allFormats.length > 0 && (
                <div style={{display:'flex', alignItems:'center', gap:'8px', marginTop:'6px'}}>
                  <span style={{fontSize:'9px', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'#52525b', whiteSpace:'nowrap', width:'80px', flexShrink:0, textAlign:'right'}}>
                    Format
                  </span>
                  <div style={{width:'1px', height:'14px', background:'#27272a', flexShrink:0}} />
                  <div style={{display:'flex', gap:'5px', flexWrap:'wrap'}}>
                    {allFormats.map((fmt) => (
                      <button
                        key={fmt}
                        onClick={() => toggleFormat(fmt)}
                        style={{
                          fontSize:'11px', padding:'3px 8px', borderRadius:'9999px', whiteSpace:'nowrap',
                          border:'none', cursor:'pointer', transition:'all 0.15s',
                          fontWeight: activeFormats.includes(fmt) ? 600 : 400,
                          background: activeFormats.includes(fmt) ? '#e4e4e7' : '#1a1a1a',
                          color: activeFormats.includes(fmt) ? '#000' : '#a1a1aa',
                          outline: activeFormats.includes(fmt) ? '2px solid #e4e4e7' : '1px solid #2a2a2a',
                          outlineOffset: activeFormats.includes(fmt) ? '1px' : '0',
                        }}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Grid */}
      <div style={{maxWidth:'1400px', margin:'0 auto', padding:'24px 32px'}}>
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="bg-[#111] rounded-xl overflow-hidden animate-pulse">
                <div className="aspect-[9/16] bg-[#1a1a1a]" />
                <div className="p-3 space-y-2">
                  <div className="h-3 bg-[#1a1a1a] rounded w-3/4" />
                  <div className="h-2.5 bg-[#1a1a1a] rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-zinc-600 text-sm">No reels match your filters</p>
            <button onClick={clearAll} className="mt-3 text.xs text-zinc-500 hover:text-white underline">
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
            {filtered.map((record, idx) => (
              <InspoCard
                key={record.id}
                record={record}
                grade={getGrade(record.engagementScore)}
                onClick={() => openModal(idx)}
                isSaved={savedIds.has(record.id)}
                onSave={handleSave}
              />
            ))}
          </div>
        )}
      </div>

      {/* Mobile Sort & Filter bottom sheet */}
      {showMobileFilters && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setShowMobileFilters(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="absolute bottom-0 left-0 right-0 bg-[#111] rounded-t-2xl border-t border-[#333] max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            style={{WebkitOverflowScrolling:'touch'}}
          >
            {/* Handle bar */}
            <div style={{display:'flex', justifyContent:'center', padding:'10px 0 6px'}}>
              <div style={{width:'36px', height:'4px', borderRadius:'2px', background:'#444'}} />
            </div>

            <div style={{padding:'0 20px 24px'}}>
              {/* Sort */}
              <p style={{fontSize:'10px', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'#52525b', marginBottom:'8px'}}>Sort by</p>
              <div style={{display:'flex', gap:'8px', marginBottom:'20px'}}>
                {[['recent','Recent'],['top','Top'],['viral','Viral']].map(([val, label]) => (
                  <button key={val} onClick={() => setSort(val)} style={{
                    flex:1, padding:'10px', borderRadius:'10px', border:'1px solid #222', cursor:'pointer',
                    background: sort === val ? '#fff' : '#1a1a1a',
                    color: sort === val ? '#000' : '#a1a1aa',
                    fontSize:'13px', fontWeight: sort === val ? 600 : 400,
                    transition:'all 0.15s',
                  }}>{label}</button>
                ))}
              </div>

              {/* Search */}
              <p style={{fontSize:'10px', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'#52525b', marginBottom:'8px'}}>Search</p>
              <input
                type="text"
                placeholder="Search reels..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width:'100%', background:'#1a1a1a', border:'1px solid #222', borderRadius:'10px',
                  padding:'10px 14px', fontSize:'14px', color:'#fff', outline:'none', marginBottom:'20px',
                  boxSizing:'border-box',
                }}
              />

              {/* Tags */}
              <p style={{fontSize:'10px', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'#52525b', marginBottom:'8px'}}>Tags</p>
              <div style={{display:'flex', flexWrap:'wrap', gap:'6px', marginBottom:'16px'}}>
                {allTags.map((tag) => (
                  <TagPill key={tag} tag={tag} active={activeTags.includes(tag)} onClick={() => toggleTag(tag)} />
                ))}
              </div>

              {/* Film format */}
              {allFormats.length > 0 && (
                <>
                  <p style={{fontSize:'10px', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'#52525b', marginBottom:'8px'}}>Format</p>
                  <div style={{display:'flex', flexWrap:'wrap', gap:'6px', marginBottom:'16px'}}>
                    {allFormats.map((fmt) => (
                      <button
                        key={fmt}
                        onClick={() => toggleFormat(fmt)}
                        style={{
                          fontSize:'11px', padding:'5px 10px', borderRadius:'9999px', cursor:'pointer',
                          border: activeFormats.includes(fmt) ? '1px solid #fff' : '1px solid #333',
                          background: activeFormats.includes(fmt) ? '#27272a' : 'transparent',
                          color: activeFormats.includes(fmt) ? '#fff' : '#71717a',
                        }}
                      >{fmt}</button>
                    ))}
                  </div>
                </>
              )}

              {/* Actions */}
              <div style={{display:'flex', gap:'10px'}}>
                {hasActiveFilters && (
                  <button onClick={clearAll} style={{flex:1, padding:'12px', borderRadius:'10px', border:'1px solid #333', background:'transparent', color:'#a1a1aa', fontSize:'14px', cursor:'pointer'}}>
                    Clear all
                  </button>
                )}
                <button onClick={() => setShowMobileFilters(false)} style={{flex:1, padding:'12px', borderRadius:'10px', border:'none', background:'#a855f7', color:'#fff', fontSize:'14px', fontWeight:600, cursor:'pointer'}}>
                  Show {filtered.length} reels
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {selectedIdx !== null && filtered[selectedIdx] && (
        <InspoModal
          record={filtered[selectedIdx]}
          grade={getGrade(filtered[selectedIdx]?.engagementScore)}
          onClose={closeModal}
          onPrev={goPrev}
          onNext={goNext}
          hasPrev={selectedIdx > 0}
          hasNext={selectedIdx < filtered.length - 1}
          isSaved={savedIds.has(filtered[selectedIdx]?.id)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
