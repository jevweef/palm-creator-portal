'use client'

import { useState, useEffect, useCallback } from 'react'
import InspoCard from '@/components/InspoCard'
import InspoModal from '@/components/InspoModal'
import { tagStyle } from '@/lib/tagStyle'

// Tag categories — tags not listed here appear under "Other"
const CATEGORY_ORDER = ['Setting', 'Niche Identity', 'Vibe / Personality', 'Subject / Body', 'Scenario', 'Other']
const TAG_CATEGORY_MAP = {
  // Setting
  'Artsy / Creative Girl':      'Setting',
  'Beach Girl':                 'Setting',
  'City Girl':                  'Setting',
  'Domestic / At-Home':         'Setting',
  'Kitchen / Food Content':     'Setting',
  'Luxury / Elevated Lifestyle':'Setting',
  'Mirror Moment':              'Setting',
  'Nature / Outdoors':          'Setting',
  'Travel / Adventure':         'Setting',

  // Niche Identity
  'Bikini / Swim':              'Niche Identity',
  'Bookish / Smart Girl':       'Niche Identity',
  'Fitness':                    'Niche Identity',
  'Fitness / Wellness':         'Niche Identity',
  'Glam / Beauty':              'Niche Identity',
  'Musician / Singer':          'Niche Identity',
  'Tattoos':                    'Niche Identity',

  // Vibe / Personality
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

  // Subject / Body
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

  // Scenario
  'Eye Contact Driven':         'Scenario',
  'POV / Personal Attention':   'Scenario',
  'Personal Attention':         'Scenario',
  'POV':                        'Scenario',
  'Roleplay':                   'Scenario',
  'Implied Scenario':           'Scenario',

  // Other
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

  // Remove empty categories (Other already in CATEGORY_ORDER — no double-append)
  return CATEGORY_ORDER
    .filter((cat) => groups[cat]?.length > 0)
    .map((cat) => ({ label: cat, tags: groups[cat] }))
}


export default function InspoBoard() {
  const [records, setRecords] = useState([])
  const [filtered, setFiltered] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selectedIdx, setSelectedIdx] = useState(null)
  const [activeTags, setActiveTags] = useState([])
  const [activeFormats, setActiveFormats] = useState([])
  const [tagMode, setTagMode] = useState('any') // 'any' | 'all'
  const [search, setSearch] = useState('')

  const [allTags, setAllTags] = useState([])
  const [allFormats, setAllFormats] = useState([])

  // Fetch data
  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        const res = await fetch('/api/inspiration')
        if (!res.ok) throw new Error('Failed to load')
        const data = await res.json()
        setRecords(data.records)
        setFiltered(data.records)

        const tagSet = new Set()
        const fmtSet = new Set()
        data.records.forEach((r) => {
          r.tags.forEach((t) => tagSet.add(t))
          r.filmFormat.forEach((f) => fmtSet.add(f))
        })
        setAllTags(Array.from(tagSet).sort())
        setAllFormats(Array.from(fmtSet).sort())
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Filter
  useEffect(() => {
    let result = records

    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (r) =>
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

    setFiltered(result)
  }, [records, search, activeTags, activeFormats, tagMode])

  const toggleTag = (tag) => {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  const toggleFormat = (fmt) => {
    setActiveFormats((prev) =>
      prev.includes(fmt) ? prev.filter((f) => f !== fmt) : [...prev, fmt]
    )
  }

  const clearAll = () => { setActiveTags([]); setActiveFormats([]); setSearch(''); setTagMode('any') }

  const openModal = (idx) => setSelectedIdx(idx)
  const closeModal = () => setSelectedIdx(null)
  const goPrev = useCallback(() => setSelectedIdx((i) => (i > 0 ? i - 1 : i)), [])
  const goNext = useCallback(() => setSelectedIdx((i) => (i < filtered.length - 1 ? i + 1 : i)), [filtered.length])

  const tagGroups = groupTags(allTags)

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur border-b border-[#1a1a1a]">
        <div style={{maxWidth:'1400px', margin:'0 auto', padding:'12px 32px'}}>

          {/* Top row */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">Palm Inspo Board</h1>
              {!loading && (
                <p className="text-xs text-zinc-600 mt-0.5">{filtered.length} reels</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {/* ANY / ALL toggle — only show when 2+ tags active */}
              {activeTags.length >= 2 && (
                <div style={{display:'flex', alignItems:'center', background:'#1a1a1a', border:'1px solid #2a2a2a', borderRadius:'9999px', padding:'2px'}}>
                  <button
                    onClick={() => setTagMode('any')}
                    style={{
                      fontSize:'11px', fontWeight:500, padding:'3px 10px', borderRadius:'9999px', border:'none', cursor:'pointer',
                      background: tagMode === 'any' ? '#fff' : 'transparent',
                      color: tagMode === 'any' ? '#000' : '#71717a',
                      transition:'all 0.15s',
                    }}
                  >
                    Match ANY
                  </button>
                  <button
                    onClick={() => setTagMode('all')}
                    style={{
                      fontSize:'11px', fontWeight:500, padding:'3px 10px', borderRadius:'9999px', border:'none', cursor:'pointer',
                      background: tagMode === 'all' ? '#fff' : 'transparent',
                      color: tagMode === 'all' ? '#000' : '#71717a',
                      transition:'all 0.15s',
                    }}
                  >
                    Match ALL
                  </button>
                </div>
              )}
              {/* Search */}
              <div className="relative w-56">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg pl-9 pr-3 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                />
              </div>
            </div>
          </div>

          {/* Tag filter rows — grouped by category */}
          <div style={{overflowX:'auto', paddingBottom:'6px'}}>
            {tagGroups.map((group, gi) => (
              <div key={group.label} style={{display:'flex', alignItems:'center', gap:'8px', marginBottom: gi < tagGroups.length - 1 ? '6px' : '0'}}>
                {/* Category label */}
                <span style={{fontSize:'9px', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'#52525b', whiteSpace:'nowrap', width:'72px', flexShrink:0, textAlign:'right'}}>
                  {group.label}
                </span>
                <div style={{width:'1px', height:'14px', background:'#27272a', flexShrink:0}} />
                {/* Tags */}
                <div style={{display:'flex', gap:'5px', flexWrap:'nowrap'}}>
                  {group.tags.map((tag) => {
                    const active = activeTags.includes(tag)
                    const ts = tagStyle(tag)
                    return (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        style={{
                          fontSize:'11px',
                          padding:'3px 8px',
                          borderRadius:'9999px',
                          whiteSpace:'nowrap',
                          border:'none',
                          cursor:'pointer',
                          fontWeight: active ? 700 : 400,
                          transition:'all 0.15s',
                          background: active ? ts.color : ts.background,
                          color: active ? '#000' : ts.color,
                          outline: active ? `2px solid ${ts.color}` : 'none',
                          outlineOffset: active ? '1px' : '0',
                          opacity: active ? 1 : 0.75,
                        }}
                      >
                        {tag}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* Film format row */}
            {allFormats.length > 0 && (
              <div style={{display:'flex', alignItems:'center', gap:'8px', marginTop:'6px'}}>
                <span style={{fontSize:'9px', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'#52525b', whiteSpace:'nowrap', width:'72px', flexShrink:0, textAlign:'right'}}>
                  Format
                </span>
                <div style={{width:'1px', height:'14px', background:'#27272a', flexShrink:0}} />
                <div style={{display:'flex', gap:'5px', flexWrap:'nowrap'}}>
                  {allFormats.map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => toggleFormat(fmt)}
                      style={{
                        fontSize:'11px',
                        padding:'3px 8px',
                        borderRadius:'9999px',
                        whiteSpace:'nowrap',
                        border:'none',
                        cursor:'pointer',
                        fontWeight: activeFormats.includes(fmt) ? 600 : 400,
                        transition:'all 0.15s',
                        background: activeFormats.includes(fmt) ? '#e4e4e7' : '#1a1a1a',
                        color: activeFormats.includes(fmt) ? '#000' : '#71717a',
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
            <button onClick={clearAll} className="mt-3 text-xs text-zinc-500 hover:text-white underline">
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
            {filtered.map((record, idx) => (
              <InspoCard
                key={record.id}
                record={record}
                onClick={() => openModal(idx)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {selectedIdx !== null && filtered[selectedIdx] && (
        <InspoModal
          record={filtered[selectedIdx]}
          onClose={closeModal}
          onPrev={goPrev}
          onNext={goNext}
          hasPrev={selectedIdx > 0}
          hasNext={selectedIdx < filtered.length - 1}
        />
      )}
    </div>
  )
}
