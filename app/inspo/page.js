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
  if (grade.startsWith('B')) return '#78B4E8'
  if (grade.startsWith('C')) return '#E8A878'
  return '#999'
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

export default function InspoBoard({ opsIdOverride, isEditor } = {}) {
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
  const [sort, setSort] = useState('top') // 'top' | 'recent' | 'viral' | 'foryou'
  const [search, setSearch] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [textOnly, setTextOnly] = useState(false)
  const [creatorTagWeights, setCreatorTagWeights] = useState({}) // { tag: weight }
  const [creatorFormatWeights, setCreatorFormatWeights] = useState({}) // { format: weight }

  const [allTags, setAllTags] = useState([])
  const [allFormats, setAllFormats] = useState([])
  const [savedIds, setSavedIds] = useState(new Set())

  // Admin: "View as Creator" for testing For You
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin'
  const [adminCreators, setAdminCreators] = useState([]) // [{ id, name }]
  const [adminSelectedCreator, setAdminSelectedCreator] = useState('')
  const [showScores, setShowScores] = useState(false)
  const [debugScores, setDebugScores] = useState({}) // { reelId: { semantic, tag, virality, hybrid } }

  const creatorOpsId = adminSelectedCreator || opsIdOverride || user?.publicMetadata?.airtableOpsId || null

  // Fetch creator list for admin picker
  useEffect(() => {
    if (!isAdmin) return
    fetch('/api/admin/palm-creators')
      .then(r => r.json())
      .then(data => {
        const creators = (data.creators || [])
          .filter(c => c.status === 'Active')
          .map(c => ({
            id: c.opsId || c.id,
            name: c.name || c.aka || 'Unknown',
            aiConversionsEnabled: !!c.aiConversionsEnabled,
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
        setAdminCreators(creators)
      })
      .catch(() => {})
  }, [isAdmin])

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

  // Fetch tag weights for this creator and auto-switch to "For You" if weights exist
  useEffect(() => {
    if (!creatorOpsId) return
    fetch(`/api/creator/tag-weights?creatorOpsId=${creatorOpsId}`)
      .then(r => r.json())
      .then(data => {
        const weights = data.tagWeights || {}
        const fmtWeights = data.filmFormatWeights || {}
        setCreatorTagWeights(weights)
        setCreatorFormatWeights(fmtWeights)
        if (Object.keys(weights).length > 0) setSort('foryou')
      })
      .catch(() => {})
  }, [creatorOpsId])

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

    if (textOnly) {
      result = result.filter((r) => r.onScreenText && r.onScreenText.trim().length > 0)
    }

    // Sort
    if (sort === 'top') {
      result.sort((a, b) => (b.engagementScore || 0) - (a.engagementScore || 0))
    } else if (sort === 'viral') {
      result.sort((a, b) => (b.views || 0) - (a.views || 0))
    } else if (sort === 'recent') {
      result.sort((a, b) => new Date(b.creatorPostedDate || 0) - new Date(a.creatorPostedDate || 0))
    } else if (sort === 'foryou' && Object.keys(creatorTagWeights).length > 0) {
      // Hybrid scoring: 50% semantic match + 35% tag overlap + 15% virality
      // Semantic match = pre-computed cosine similarity between reel and creator embeddings
      // Tag match = content tags (full) + film format (0.5x), normalized to 0-1
      // Virality = z-score normalized to 0-1

      const tagScores = result.map(r => {
        const tagScore = [...(r.tags || []), ...(r.suggestedTags || [])].reduce((s, t) => s + (creatorTagWeights[t] || 0), 0)
        const fmtScore = (r.filmFormat || []).reduce((s, f) => s + (creatorFormatWeights[f] || 0), 0) * 0.5
        return tagScore + fmtScore
      })
      const maxTag = Math.max(...tagScores, 1)

      const zScores = result.map(r => r.zScore || 0)
      const maxZ = Math.max(...zScores.map(Math.abs), 1)

      result.sort((a, b) => {
        const idxA = result.indexOf(a)
        const idxB = result.indexOf(b)

        const semanticA = (a.semanticScores && a.semanticScores[creatorOpsId]) || 0
        const semanticB = (b.semanticScores && b.semanticScores[creatorOpsId]) || 0
        const tagA = tagScores[idxA] / maxTag
        const tagB = tagScores[idxB] / maxTag
        const viralA = (zScores[idxA] + maxZ) / (2 * maxZ)
        const viralB = (zScores[idxB] + maxZ) / (2 * maxZ)

        const hybridA = 0.5 * semanticA + 0.35 * tagA + 0.15 * viralA
        const hybridB = 0.5 * semanticB + 0.35 * tagB + 0.15 * viralB
        return hybridB - hybridA
      })

      // Store debug scores for admin overlay
      if (isAdmin) {
        const scores = {}
        result.forEach((r, i) => {
          const semantic = (r.semanticScores && r.semanticScores[creatorOpsId]) || 0
          const tag = tagScores[result.indexOf(r)] / maxTag
          const viral = (zScores[result.indexOf(r)] + maxZ) / (2 * maxZ)
          scores[r.id] = {
            semantic: Math.round(semantic * 100),
            tag: Math.round(tag * 100),
            virality: Math.round(viral * 100),
            hybrid: Math.round((0.5 * semantic + 0.35 * tag + 0.15 * viral) * 100),
          }
        })
        setDebugScores(scores)
      }
    }

    setFiltered(result)
  }, [records, search, activeTags, activeFormats, tagMode, sort, textOnly, creatorTagWeights, creatorFormatWeights, creatorOpsId, isAdmin])

  const toggleTag = (tag) => setActiveTags((prev) =>
    prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
  )
  const toggleFormat = (fmt) => setActiveFormats((prev) =>
    prev.includes(fmt) ? prev.filter((f) => f !== fmt) : [...prev, fmt]
  )
  const clearAll = () => { setActiveTags([]); setActiveFormats([]); setSearch(''); setTagMode('any'); setSort('top') }

  const PAGE_SIZE = 84 // 7 columns × 12 rows
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // Reset visible count when filters/sort change
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [sort, activeTags, activeFormats, search, tagMode])

  const openModal = (idx) => setSelectedIdx(idx)
  const closeModal = () => setSelectedIdx(null)
  const goPrev = useCallback(() => setSelectedIdx((i) => (i > 0 ? i - 1 : i)), [])
  const goNext = useCallback(() => setSelectedIdx((i) => (i < filtered.length - 1 ? i + 1 : i)), [filtered.length])

  const allKnownTags = [...new Set([...Object.keys(TAG_CATEGORY_MAP), ...allTags])]
  const tagGroups = groupTags(allKnownTags)
  const pinnedAvailable = PINNED_TAGS.filter((t) => allKnownTags.includes(t))
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
        background: sort === value ? 'var(--palm-pink)' : 'transparent',
        color: sort === value ? '#060606' : 'var(--foreground-muted)',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="min-h-screen bg-[#060606]">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#060606]/95 backdrop-blur" style={{boxShadow:'0 1px 4px rgba(0,0,0,0.04)'}}>
        <div className="px-4 md:px-8" style={{maxWidth:'1400px', margin:'0 auto', paddingTop:'12px', paddingBottom:'12px'}}>

          {/* Mobile: title + filter button */}
          <div className="flex md:hidden items-center justify-between">
            <div>
              <h1 style={{fontSize:'16px', fontWeight:700, color:'var(--foreground)', margin:0}}>Inspo Board</h1>
              {!loading && (
                <p style={{fontSize:'11px', color:'#999', marginTop:'1px'}}>{filtered.length} reels</p>
              )}
            </div>
            <button
              onClick={() => setShowMobileFilters(true)}
              style={{
                display:'flex', alignItems:'center', gap:'6px',
                background:'rgba(255,255,255,0.08)', border:'none', boxShadow:'0 1px 4px rgba(0,0,0,0.06)', borderRadius:'9999px',
                padding:'7px 14px', fontSize:'12px', fontWeight:500, color:'rgba(240, 236, 232, 0.75)', cursor:'pointer',
              }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filter
              {(activeTags.length + activeFormats.length) > 0 && (
                <span style={{background:'var(--palm-pink)', color:'rgba(255,255,255,0.08)', borderRadius:'9999px', fontSize:'9px', fontWeight:700, padding:'1px 6px'}}>
                  {activeTags.length + activeFormats.length}
                </span>
              )}
            </button>
          </div>
          {/* Mobile: sort buttons always visible */}
          <div className="flex md:hidden" style={{gap:'6px', marginTop:'10px', overflowX:'auto', paddingBottom:'2px'}}>
            <div style={{display:'flex', alignItems:'center', background:'rgba(255,255,255,0.08)', boxShadow:'0 1px 4px rgba(0,0,0,0.06)', borderRadius:'9999px', padding:'2px', gap:'1px'}}>
              {creatorOpsId && Object.keys(creatorTagWeights).length > 0 && (
                <SortBtn value="foryou" label="For You" />
              )}
              <SortBtn value="top" label="Top" />
              <SortBtn value="viral" label="Viral" />
              <SortBtn value="recent" label="Recent" />
            </div>
          </div>

          {/* Desktop: single row — sort + tags + search — NO wrap */}
          <div className="hidden md:flex items-center gap-2" style={{flexWrap:'nowrap'}}>
            {/* Sort toggle */}
            <div style={{display:'flex', alignItems:'center', background:'rgba(255,255,255,0.08)', boxShadow:'0 1px 4px rgba(0,0,0,0.06)', border:'none', borderRadius:'9999px', padding:'2px', gap:'1px', flexShrink:0}}>
              {creatorOpsId && Object.keys(creatorTagWeights).length > 0 && (
                <SortBtn value="foryou" label="For You" />
              )}
              <SortBtn value="top" label="Top" />
              <SortBtn value="viral" label="Viral" />
              <SortBtn value="recent" label="Recent" />
            </div>

            {/* Editor-only: Text on screen filter */}
            {isEditor && (
              <button
                onClick={() => setTextOnly(v => !v)}
                style={{
                  fontSize: '11px', padding: '3px 10px', borderRadius: '9999px', flexShrink: 0,
                  border: textOnly ? '1px solid #f59e0b' : 'none',
                  boxShadow: textOnly ? 'none' : '0 1px 3px rgba(0,0,0,0.06)',
                  cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
                  background: textOnly ? 'rgba(232, 200, 120, 0.06)' : 'transparent',
                  color: textOnly ? '#E8C878' : '#999',
                  fontWeight: textOnly ? 700 : 400,
                }}
              >
                {textOnly ? '✕ ' : ''}Text on screen
              </button>
            )}

            {/* Divider */}
            <div style={{width:'1px', height:'20px', background:'rgba(255,255,255,0.06)', flexShrink:0}} />

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
                fontSize:'11px', padding:'3px 10px', borderRadius:'9999px', border:'none', boxShadow:'0 1px 3px rgba(0,0,0,0.06)',
                cursor:'pointer', background: showAdvanced ? 'rgba(232, 160, 160, 0.06)' : 'transparent',
                color: showAdvanced ? 'var(--palm-pink)' : '#999',
                display:'flex', alignItems:'center', gap:'4px', transition:'all 0.15s', flexShrink:0, whiteSpace:'nowrap',
              }}
            >
              {showAdvanced ? '▲' : '▼'} {showAdvanced ? 'Less' : 'More'} filters
              {(activeTags.filter(t => !PINNED_TAGS.includes(t)).length + activeFormats.length) > 0 && (
                <span style={{background:'rgba(255,255,255,0.08)', color:'#000', borderRadius:'9999px', fontSize:'9px', fontWeight:700, padding:'0 5px', marginLeft:'2px'}}>
                  {activeTags.filter(t => !PINNED_TAGS.includes(t)).length + activeFormats.length}
                </span>
              )}
            </button>

            {/* ANY/ALL — only when 2+ tags */}
            {activeTags.length >= 2 && (
              <div style={{display:'flex', alignItems:'center', background:'rgba(255,255,255,0.08)', boxShadow:'0 1px 4px rgba(0,0,0,0.06)', border:'none', borderRadius:'9999px', padding:'2px', flexShrink:0}}>
                {['any','all'].map((m) => (
                  <button key={m} onClick={() => setTagMode(m)} style={{
                    fontSize:'11px', fontWeight:500, padding:'3px 10px', borderRadius:'9999px', border:'none', cursor:'pointer',
                    background: tagMode === m ? 'var(--palm-pink)' : 'transparent',
                    color: tagMode === m ? 'rgba(255,255,255,0.08)' : '#999',
                    transition:'all 0.15s',
                  }}>
                    {m === 'any' ? 'Match ANY' : 'Match ALL'}
                  </button>
                ))}
              </div>
            )}

            {/* Clear all — only when filters active */}
            {hasActiveFilters && (
              <button onClick={clearAll} style={{fontSize:'11px', color:'#999', background:'none', border:'none', cursor:'pointer', textDecoration:'underline', flexShrink:0, whiteSpace:'nowrap'}}>
                Clear all
              </button>
            )}

            {/* Spacer to push search right */}
            <div style={{flex:1}} />

            {/* Reel count */}
            {!loading && (
              <span style={{fontSize:'11px', color:'#999'}}>{filtered.length} reels</span>
            )}

            {/* Search */}
            <div style={{position:'relative'}}>
              <svg style={{position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', width:'13px', height:'13px', color:'#999'}} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width:'200px', background:'rgba(255,255,255,0.08)', border:'1px solid transparent', borderRadius:'8px',
                  paddingLeft:'30px', paddingRight:'12px', paddingTop:'6px', paddingBottom:'6px',
                  fontSize:'13px', color:'var(--foreground)', outline:'none',
                }}
              />
            </div>
          </div>

          {/* Advanced panel */}
          {showAdvanced && (
            <div style={{marginTop:'10px', paddingTop:'10px', borderTop:'1px solid transparent'}}>
              {tagGroups.map((group, gi) => (
                <div key={group.label} style={{display:'flex', alignItems:'center', gap:'8px', marginBottom: gi < tagGroups.length - 1 ? '6px' : '0'}}>
                  <span style={{fontSize:'9px', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'#999', whiteSpace:'nowrap', width:'80px', flexShrink:0, textAlign:'right'}}>
                    {group.label}
                  </span>
                  <div style={{width:'1px', height:'14px', background:'rgba(255,255,255,0.06)', flexShrink:0}} />
                  <div style={{display:'flex', gap:'5px', flexWrap:'wrap'}}>
                    {group.tags.map((tag) => (
                      <TagPill key={tag} tag={tag} active={activeTags.includes(tag)} onClick={() => toggleTag(tag)} />
                    ))}
                  </div>
                </div>
              ))}

              {allFormats.length > 0 && (
                <div style={{display:'flex', alignItems:'center', gap:'8px', marginTop:'6px'}}>
                  <span style={{fontSize:'9px', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'#999', whiteSpace:'nowrap', width:'80px', flexShrink:0, textAlign:'right'}}>
                    Format
                  </span>
                  <div style={{width:'1px', height:'14px', background:'rgba(255,255,255,0.06)', flexShrink:0}} />
                  <div style={{display:'flex', gap:'5px', flexWrap:'wrap'}}>
                    {allFormats.map((fmt) => (
                      <button
                        key={fmt}
                        onClick={() => toggleFormat(fmt)}
                        style={{
                          fontSize:'11px', padding:'3px 8px', borderRadius:'9999px', whiteSpace:'nowrap',
                          border:'none', cursor:'pointer', transition:'all 0.15s',
                          fontWeight: activeFormats.includes(fmt) ? 600 : 400,
                          background: activeFormats.includes(fmt) ? 'var(--palm-pink)' : 'rgba(232, 160, 160, 0.06)',
                          color: activeFormats.includes(fmt) ? 'var(--foreground)' : '#888',
                          outline: activeFormats.includes(fmt) ? '1px solid var(--palm-pink)' : 'none',
                          boxShadow: activeFormats.includes(fmt) ? 'none' : '0 1px 3px rgba(0,0,0,0.04)',
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

      {/* Admin: View as Creator bar */}
      {isAdmin && adminCreators.length > 0 && (
        <div className="px-4 md:px-8" style={{ maxWidth: '1400px', margin: '0 auto', paddingTop: '12px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            background: 'rgba(232, 200, 120, 0.06)', border: '1px solid #FFE082', borderRadius: '10px',
            padding: '10px 16px', fontSize: '13px',
          }}>
            <span style={{ fontWeight: 600, color: '#E8A878', flexShrink: 0 }}>Admin Preview</span>
            <select
              value={adminSelectedCreator}
              onChange={e => {
                setAdminSelectedCreator(e.target.value)
                if (e.target.value) setSort('foryou')
              }}
              style={{
                padding: '5px 10px', borderRadius: '6px', border: '1px solid transparent',
                fontSize: '13px', background: 'var(--card-bg-solid)', cursor: 'pointer',
              }}
            >
              <option value="">— Select Creator —</option>
              {adminCreators.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {adminSelectedCreator && sort === 'foryou' && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', color: 'rgba(240, 236, 232, 0.75)' }}>
                  <input
                    type="checkbox"
                    checked={showScores}
                    onChange={e => setShowScores(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  Show Scores
                </label>
                {showScores && (
                  <span style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>
                    S = Semantic (50%) &middot; T = Tags (35%) &middot; V = Virality (15%)
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="px-4 md:px-8 py-4 md:py-6" style={{maxWidth:'1400px', margin:'0 auto'}}>
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="bg-[#0f0f0f] rounded-xl overflow-hidden animate-pulse">
                <div className="aspect-[9/16] bg-[rgba(232,160,160,0.06)]" />
                <div className="p-3 space-y-2">
                  <div className="h-3 bg-[rgba(232,160,160,0.06)] rounded w-3/4" />
                  <div className="h-2.5 bg-[rgba(232,160,160,0.06)] rounded w-1/2" />
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
          <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
            {filtered.slice(0, visibleCount).map((record, idx) => (
              <div key={record.id} style={{ position: 'relative' }}>
                <InspoCard
                  record={record}
                  grade={getGrade(record.engagementScore)}
                  onClick={() => openModal(idx)}
                  isSaved={savedIds.has(record.id)}
                  onSave={handleSave}
                />
                {showScores && sort === 'foryou' && debugScores[record.id] && (
                  <div style={{
                    position: 'absolute', top: '4px', left: '4px', right: '4px',
                    background: 'rgba(0,0,0,0.75)', borderRadius: '6px',
                    padding: '5px 7px', fontSize: '10px', color: 'var(--foreground)',
                    lineHeight: '1.5', pointerEvents: 'none', zIndex: 5,
                  }}>
                    <div style={{ fontWeight: 700, fontSize: '12px', marginBottom: '2px' }}>
                      {debugScores[record.id].hybrid}
                    </div>
                    <div>S: {debugScores[record.id].semantic} &middot; T: {debugScores[record.id].tag} &middot; V: {debugScores[record.id].virality}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {visibleCount < filtered.length && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <button onClick={() => setVisibleCount(v => v + PAGE_SIZE)} style={{
                background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px',
                padding: '12px 32px', fontSize: '14px', fontWeight: 600, color: 'rgba(240, 236, 232, 0.75)',
                cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                transition: '0.2s',
              }}>
                Load More ({filtered.length - visibleCount} remaining)
              </button>
              <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', marginTop: '8px' }}>
                Showing {Math.min(visibleCount, filtered.length)} of {filtered.length}
              </div>
            </div>
          )}
          </>
        )}
      </div>

      {/* Mobile Sort & Filter bottom sheet */}
      {showMobileFilters && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setShowMobileFilters(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute bottom-0 left-0 right-0 bg-[#0f0f0f] rounded-t-2xl max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            style={{boxShadow:'0 -4px 20px rgba(0,0,0,0.08)', WebkitOverflowScrolling:'touch'}}
          >
            {/* Handle bar */}
            <div style={{display:'flex', justifyContent:'center', padding:'10px 0 6px'}}>
              <div style={{width:'36px', height:'4px', borderRadius:'2px', background:'rgba(212, 160, 176, 0.3)'}} />
            </div>

            <div style={{padding:'0 20px 24px'}}>
              {/* Sort */}
              <p style={{fontSize:'10px', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'#999', marginBottom:'8px'}}>Sort by</p>
              <div style={{display:'flex', gap:'8px', marginBottom:'20px'}}>
                {[
                  ...(creatorOpsId && Object.keys(creatorTagWeights).length > 0 ? [['foryou','For You']] : []),
                  ['recent','Recent'],['top','Top'],['viral','Viral']
                ].map(([val, label]) => (
                  <button key={val} onClick={() => setSort(val)} style={{
                    flex:1, padding:'10px', borderRadius:'10px', border:'none', boxShadow:'0 1px 4px rgba(0,0,0,0.06)', cursor:'pointer',
                    background: sort === val ? 'var(--palm-pink)' : 'var(--background)',
                    color: sort === val ? 'rgba(255,255,255,0.08)' : '#888',
                    fontSize:'13px', fontWeight: sort === val ? 600 : 400,
                    transition:'all 0.15s',
                  }}>{label}</button>
                ))}
              </div>

              {/* Search */}
              <p style={{fontSize:'10px', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'#999', marginBottom:'8px'}}>Search</p>
              <input
                type="text"
                placeholder="Search reels..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width:'100%', background:'rgba(255,255,255,0.08)', border:'1px solid transparent', borderRadius:'10px',
                  padding:'10px 14px', fontSize:'14px', color:'var(--foreground)', outline:'none', marginBottom:'20px',
                  boxSizing:'border-box',
                }}
              />

              {/* Tags */}
              <p style={{fontSize:'10px', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'#999', marginBottom:'8px'}}>Tags</p>
              <div style={{display:'flex', flexWrap:'wrap', gap:'6px', marginBottom:'16px'}}>
                {allTags.map((tag) => (
                  <TagPill key={tag} tag={tag} active={activeTags.includes(tag)} onClick={() => toggleTag(tag)} />
                ))}
              </div>

              {/* Film format */}
              {allFormats.length > 0 && (
                <>
                  <p style={{fontSize:'10px', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'#999', marginBottom:'8px'}}>Format</p>
                  <div style={{display:'flex', flexWrap:'wrap', gap:'6px', marginBottom:'16px'}}>
                    {allFormats.map((fmt) => (
                      <button
                        key={fmt}
                        onClick={() => toggleFormat(fmt)}
                        style={{
                          fontSize:'11px', padding:'5px 10px', borderRadius:'9999px', cursor:'pointer',
                          border: activeFormats.includes(fmt) ? '1px solid #E88FAC' : 'none',
                          boxShadow: activeFormats.includes(fmt) ? 'none' : '0 1px 3px rgba(0,0,0,0.06)',
                          background: activeFormats.includes(fmt) ? 'rgba(232, 160, 160, 0.06)' : 'transparent',
                          color: activeFormats.includes(fmt) ? 'var(--palm-pink)' : '#999',
                        }}
                      >{fmt}</button>
                    ))}
                  </div>
                </>
              )}

              {/* Actions */}
              <div style={{display:'flex', gap:'10px'}}>
                {hasActiveFilters && (
                  <button onClick={clearAll} style={{flex:1, padding:'12px', borderRadius:'10px', border:'none', boxShadow:'0 1px 4px rgba(0,0,0,0.06)', background:'transparent', color:'#888', fontSize:'14px', cursor:'pointer'}}>
                    Clear all
                  </button>
                )}
                <button onClick={() => setShowMobileFilters(false)} style={{flex:1, padding:'12px', borderRadius:'10px', border:'none', background:'var(--palm-pink)', color:'rgba(255,255,255,0.08)', fontSize:'14px', fontWeight:600, cursor:'pointer'}}>
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
          viewAsCreator={isAdmin && adminSelectedCreator
            ? adminCreators.find(c => c.id === adminSelectedCreator) || null
            : null}
        />
      )}
    </div>
  )
}
