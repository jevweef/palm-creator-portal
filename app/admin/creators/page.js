'use client'

import { useState, useEffect, useRef } from 'react'

const TAG_CATEGORIES = [
  'Setting / Location',
  'Persona / Niche',
  'Tone / Energy',
  'Visual / Body',
  'Viewer Experience',
]

const STATUS_STYLES = {
  'Not Started':       { bg: '#1a1a1a', text: '#71717a', border: '#333' },
  'Ready to Analyze':  { bg: '#0a1e3d', text: '#60a5fa', border: '#1e3a5f' },
  'Analyzing':         { bg: '#332b00', text: '#f59e0b', border: '#5c4b00' },
  'Analyzed':          { bg: '#0a2e0a', text: '#22c55e', border: '#1a5c1a' },
  'Reanalyze':         { bg: '#2d1f00', text: '#fb923c', border: '#5c3d00' },
}

// Derive display status from analysis status + documents + dates
function getDisplayStatus(profileAnalysisStatus, documents, profileLastAnalyzed, analyzing) {
  if (analyzing) return 'Analyzing'
  if (profileAnalysisStatus === 'Analyzing') return 'Analyzing'
  if (profileAnalysisStatus === 'Complete') {
    // Check if any doc was uploaded after the last analysis
    if (profileLastAnalyzed && documents.length > 0) {
      const hasNewDocs = documents.some(d => d.uploadDate > profileLastAnalyzed)
      if (hasNewDocs) return 'Reanalyze'
    }
    return 'Analyzed'
  }
  if (documents.length > 0) return 'Ready to Analyze'
  return 'Not Started'
}

function StatusPill({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES['Not Started']
  return (
    <span style={{
      padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
      background: s.bg, color: s.text, border: `1px solid ${s.border}`,
    }}>
      {status || 'Not Started'}
    </span>
  )
}

function WeightBar({ tag, weight, category }) {
  const catColors = {
    'Setting / Location': '#06b6d4',
    'Persona / Niche':    '#a78bfa',
    'Tone / Energy':      '#f472b6',
    'Visual / Body':      '#fb923c',
    'Viewer Experience':  '#60a5fa',
  }
  const color = catColors[category] || '#a78bfa'
  return (
    <div style={{ marginBottom: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
        <span style={{ fontSize: '12px', color: '#d4d4d8' }}>{tag}</span>
        <span style={{ fontSize: '12px', fontWeight: 600, color, minWidth: '28px', textAlign: 'right' }}>{weight}</span>
      </div>
      <div style={{ height: '4px', background: '#222', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${weight}%`, background: color, borderRadius: '2px', transition: 'width 0.4s ease' }} />
      </div>
    </div>
  )
}

function TagWeightPanel({ tagWeights }) {
  if (!tagWeights || tagWeights.length === 0) {
    return <div style={{ color: '#555', fontSize: '13px', padding: '12px 0' }}>No tag weights yet — run analysis first.</div>
  }

  const byCategory = {}
  tagWeights.forEach(tw => {
    const cat = tw.category || 'Other'
    if (!byCategory[cat]) byCategory[cat] = []
    byCategory[cat].push(tw)
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {TAG_CATEGORIES.map(cat => {
        const tags = (byCategory[cat] || []).sort((a, b) => b.weight - a.weight)
        if (!tags.length) return null
        return (
          <div key={cat}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>{cat}</div>
            {tags.map(tw => (
              <WeightBar key={tw.tag} tag={tw.tag} weight={tw.weight} category={cat} />
            ))}
          </div>
        )
      })}
    </div>
  )
}

function DocumentRow({ doc, onDelete }) {
  const typeColors = {
    Audio: '#a78bfa', Transcript: '#60a5fa', PDF: '#fb923c',
    'Meeting Notes': '#34d399', Other: '#71717a',
  }
  const color = typeColors[doc.fileType] || '#71717a'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '10px 12px', background: '#111', borderRadius: '8px',
      border: '1px solid #222',
    }}>
      <span style={{ fontSize: '11px', fontWeight: 600, color, background: '#1a1a1a', border: `1px solid ${color}30`, padding: '2px 6px', borderRadius: '4px', flexShrink: 0 }}>
        {doc.fileType}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.fileName}</div>
        {doc.notes && <div style={{ fontSize: '11px', color: '#71717a', marginTop: '2px' }}>{doc.notes}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        {doc.hasExtractedText && (
          <span style={{ fontSize: '11px', color: '#22c55e' }}>Text extracted</span>
        )}
        {!doc.hasExtractedText && doc.analysisStatus === 'Pending' && (
          <span style={{ fontSize: '11px', color: '#f59e0b' }}>Pending extraction</span>
        )}
        <span style={{ fontSize: '11px', color: '#555' }}>{doc.uploadDate || '—'}</span>
      </div>
    </div>
  )
}

function UploadModal({ creator, onClose, onUploaded }) {
  const [fileType, setFileType] = useState('Audio')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const fileRef = useRef()

  const submit = async () => {
    if (!file) { setError('Please select a file.'); return }
    setUploading(true)
    setError('')
    try {
      const fd = new FormData()
      // Step 1: get a short-lived Dropbox token + upload path from the server
      const tokenRes = await fetch(`/api/admin/creator-profile/upload-token?creatorName=${encodeURIComponent(creator.name || creator.aka)}`)
      const tokenData = await tokenRes.json()
      if (!tokenRes.ok) throw new Error(tokenData.error || 'Failed to get upload token')
      const { accessToken, namespaceId, uploadPathPrefix } = tokenData
      const dropboxPath = `${uploadPathPrefix}/${file.name}`

      // Step 2: upload directly to Dropbox from the browser (bypasses Vercel body limit)
      const uploadRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath, mode: 'add', autorename: true, mute: true }),
          'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: namespaceId }),
          'Content-Type': 'application/octet-stream',
        },
        body: file,
      })
      const uploadData = await uploadRes.json()
      if (!uploadRes.ok) throw new Error(uploadData.error_summary || 'Dropbox upload failed')
      const storedPath = uploadData.path_display || dropboxPath

      // Step 3: register the Airtable record (lightweight JSON, no file)
      const res = await fetch('/api/admin/creator-profile/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: creator.id, fileType, notes, fileName: file.name, dropboxPath: storedPath }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to register document')
      setResult({ ...data, fileName: file.name })
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#111', border: '1px solid #333', borderRadius: '12px', padding: '28px', width: '480px', maxWidth: '95vw' }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '20px' }}>
          Upload Document — {creator.name || creator.aka}
        </div>

        {result ? (
          <div>
            <div style={{ color: '#22c55e', fontSize: '14px', marginBottom: '12px' }}>
              Uploaded successfully.{result.isAudio ? ' Audio will be transcribed when you run analysis.' : ''}
            </div>
            <div style={{ fontSize: '12px', color: '#71717a', marginBottom: '20px' }}>{result.fileName}</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => { setResult(null); setFile(null); setNotes('') }}
                style={{ flex: 1, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: '6px', padding: '8px', cursor: 'pointer', fontSize: '13px' }}>
                Upload Another
              </button>
              <button onClick={() => { onUploaded(); onClose() }}
                style={{ flex: 1, background: '#a78bfa', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', color: '#71717a', display: 'block', marginBottom: '6px' }}>File Type</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {['Audio', 'Transcript', 'PDF', 'Meeting Notes', 'Other'].map(t => (
                  <button key={t} onClick={() => setFileType(t)}
                    style={{
                      padding: '6px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
                      background: fileType === t ? '#a78bfa' : '#1a1a1a',
                      color: fileType === t ? '#fff' : '#a1a1aa',
                      border: fileType === t ? '1px solid #a78bfa' : '1px solid #333',
                    }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', color: '#71717a', display: 'block', marginBottom: '6px' }}>File</label>
              <div
                onClick={() => fileRef.current?.click()}
                style={{
                  border: '1px dashed #444', borderRadius: '8px', padding: '20px', textAlign: 'center',
                  cursor: 'pointer', background: '#0a0a0a', color: file ? '#fff' : '#555', fontSize: '13px',
                }}>
                {file ? file.name : 'Click to select a file'}
              </div>
              <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0])} />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '12px', color: '#71717a', display: 'block', marginBottom: '6px' }}>Notes (optional)</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Onboarding call Jan 2026"
                style={{ width: '100%', background: '#0a0a0a', border: '1px solid #333', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px', boxSizing: 'border-box' }} />
            </div>

            {error && <div style={{ color: '#ef4444', fontSize: '12px', marginBottom: '12px' }}>{error}</div>}

            {fileType === 'Audio' && (
              <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '16px', padding: '8px 10px', background: '#0a0a0a', border: '1px solid #222', borderRadius: '6px' }}>
                Audio uploads directly to Dropbox. Whisper transcription runs when you hit "Run Analysis."
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={onClose}
                style={{ flex: 1, background: '#1a1a1a', color: '#a1a1aa', border: '1px solid #333', borderRadius: '6px', padding: '8px', cursor: 'pointer', fontSize: '13px' }}>
                Cancel
              </button>
              <button onClick={submit} disabled={uploading || !file}
                style={{
                  flex: 2, background: uploading ? '#333' : '#a78bfa', color: '#fff', border: 'none',
                  borderRadius: '6px', padding: '8px', cursor: uploading || !file ? 'not-allowed' : 'pointer',
                  fontSize: '13px', fontWeight: 600, opacity: !file ? 0.5 : 1,
                }}>
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CreatorDetail({ creator, onProfileUpdated }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [analyzeResult, setAnalyzeResult] = useState(null)
  const [analyzeError, setAnalyzeError] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [activeTab, setActiveTab] = useState('profile')

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/creator-profile?creatorId=${creator.id}`)
      const data = await res.json()
      setProfile(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [creator.id])

  const resetAnalysis = async () => {
    setResetting(true)
    setAnalyzeResult(null)
    setAnalyzeError('')
    try {
      const res = await fetch('/api/admin/creator-profile/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: creator.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Reset failed')
      load()
      onProfileUpdated(creator.id, 'Not Started')
    } catch (e) {
      setAnalyzeError(e.message)
    } finally {
      setResetting(false)
    }
  }

  const runAnalysis = async () => {
    setAnalyzing(true)
    setAnalyzeError('')
    setAnalyzeResult(null)
    try {
      const res = await fetch('/api/admin/creator-profile/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: creator.id, creatorName: creator.name || creator.aka }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Analysis failed')
      setAnalyzeResult(data)
      load()
      onProfileUpdated(creator.id, 'Complete')
    } catch (e) {
      setAnalyzeError(e.message)
      onProfileUpdated(creator.id, 'Not Started')
    } finally {
      setAnalyzing(false)
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: '#555', fontSize: '13px' }}>
      Loading...
    </div>
  )

  const { documents = [], tagWeights = [] } = profile || {}
  const c = profile?.creator || {}

  const status = getDisplayStatus(c.profileAnalysisStatus, documents, c.profileLastAnalyzed, analyzing)
  const topTags = [...tagWeights].sort((a, b) => b.weight - a.weight).slice(0, 3)

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#fff' }}>{creator.name}</div>
          {creator.aka && <div style={{ fontSize: '13px', color: '#71717a', marginTop: '2px' }}>aka {creator.aka}</div>}
          <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <StatusPill status={status} />
            {c.profileLastAnalyzed && (
              <span style={{ fontSize: '11px', color: '#555' }}>Last analyzed {c.profileLastAnalyzed}</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
          <button onClick={() => setShowUpload(true)}
            style={{ background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: '6px', padding: '7px 14px', fontSize: '12px', cursor: 'pointer', fontWeight: 500 }}>
            + Upload
          </button>
          {(status === 'Analyzed' || status === 'Reanalyze' || status === 'Analyzing') && (
            <button onClick={resetAnalysis} disabled={resetting}
              style={{
                background: '#1a1a1a', color: '#71717a', border: '1px solid #333',
                borderRadius: '6px', padding: '7px 14px', fontSize: '12px', fontWeight: 500,
                cursor: resetting ? 'not-allowed' : 'pointer', opacity: resetting ? 0.5 : 1,
              }}>
              {resetting ? 'Resetting...' : 'Reset'}
            </button>
          )}
          <button onClick={runAnalysis} disabled={analyzing}
            style={{
              background: analyzing ? '#333' : '#a78bfa', color: '#fff', border: 'none',
              borderRadius: '6px', padding: '7px 16px', fontSize: '12px', fontWeight: 600,
              cursor: analyzing ? 'not-allowed' : 'pointer', opacity: analyzing ? 0.7 : 1,
            }}>
            {analyzing ? 'Analyzing...' : (status === 'Analyzed' || status === 'Reanalyze' ? 'Reanalyze' : 'Run Analysis')}
          </button>
        </div>
      </div>

      {analyzeResult && (
        <div style={{ background: '#0a2e0a', border: '1px solid #1a5c1a', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: '#22c55e' }}>
          Analysis complete. {analyzeResult.documentsAnalyzed} document(s) analyzed.
          {analyzeResult.topTags?.length > 0 && (
            <span style={{ color: '#a1a1aa' }}> Top tags: {analyzeResult.topTags.map(t => `${t.tag} (${t.weight})`).join(', ')}</span>
          )}
        </div>
      )}

      {analyzeError && (
        <div style={{ background: '#2d1515', border: '1px solid #5c2020', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: '#ef4444' }}>
          {analyzeError}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid #222', marginBottom: '20px' }}>
        {[['profile', 'Profile'], ['documents', `Documents (${documents.length})`], ['tags', 'Tag Weights']].map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key)}
            style={{
              padding: '8px 16px', fontSize: '13px', fontWeight: activeTab === key ? 600 : 400,
              color: activeTab === key ? '#fff' : '#71717a', background: 'none', border: 'none',
              borderBottom: activeTab === key ? '2px solid #a78bfa' : '2px solid transparent',
              cursor: 'pointer', marginBottom: '-1px',
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* Profile tab */}
      {activeTab === 'profile' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {!c.profileSummary && status !== 'Complete' && (
            <div style={{ color: '#555', fontSize: '13px', padding: '12px', background: '#111', borderRadius: '8px', border: '1px solid #222' }}>
              No profile yet. Upload documents and run analysis to generate.
            </div>
          )}

          {c.profileSummary && (
            <ProfileSection label="Profile Summary" text={c.profileSummary} />
          )}
          {c.brandVoiceNotes && (
            <ProfileSection label="Brand Voice" text={c.brandVoiceNotes} />
          )}
          {c.contentDirectionNotes && (
            <ProfileSection label="Content Direction" text={c.contentDirectionNotes} />
          )}
          {c.dosDonts && (
            <ProfileSection label="Do / Don't" text={c.dosDonts} mono />
          )}

          {topTags.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>Top Tags</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {topTags.map(tw => (
                  <span key={tw.tag} style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 500, background: '#1a1a2e', color: '#a78bfa', border: '1px solid #2d2d4e' }}>
                    {tw.tag} · {tw.weight}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Documents tab */}
      {activeTab === 'documents' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {documents.length === 0 && (
            <div style={{ color: '#555', fontSize: '13px', padding: '12px', background: '#111', borderRadius: '8px', border: '1px solid #222' }}>
              No documents yet. Click "+ Upload" to add voice memos, transcripts, or notes.
            </div>
          )}
          {documents.map(doc => (
            <DocumentRow key={doc.id} doc={doc} />
          ))}
          <button onClick={() => setShowUpload(true)}
            style={{ marginTop: '4px', background: '#0a0a0a', color: '#71717a', border: '1px dashed #333', borderRadius: '8px', padding: '10px', fontSize: '13px', cursor: 'pointer' }}>
            + Upload another document
          </button>
        </div>
      )}

      {/* Tag weights tab */}
      {activeTab === 'tags' && (
        <TagWeightPanel tagWeights={tagWeights} />
      )}

      {showUpload && (
        <UploadModal
          creator={creator}
          onClose={() => setShowUpload(false)}
          onUploaded={load}
        />
      )}
    </div>
  )
}

function ProfileSection({ label, text, mono }) {
  return (
    <div>
      <div style={{ fontSize: '11px', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>{label}</div>
      <div style={{
        fontSize: '13px', color: '#d4d4d8', lineHeight: '1.6', whiteSpace: 'pre-wrap',
        fontFamily: mono ? 'monospace' : 'inherit', background: '#111',
        borderRadius: '8px', padding: '12px 14px', border: '1px solid #222',
      }}>
        {text}
      </div>
    </div>
  )
}

export default function CreatorsPage() {
  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    fetch('/api/admin/palm-creators')
      .then(r => r.json())
      .then(data => {
        setCreators(data.creators || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleProfileUpdated = (creatorId, status) => {
    setCreators(prev => prev.map(c => c.id === creatorId ? { ...c, profileAnalysisStatus: status } : c))
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '22px', fontWeight: 700, color: '#fff' }}>Creator Profiles</div>
        <div style={{ fontSize: '13px', color: '#71717a', marginTop: '4px' }}>Upload documents and generate AI-powered creator profiles and tag weights.</div>
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
        {/* Creator list */}
        <div style={{ width: '220px', flexShrink: 0 }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Creators</div>
          {loading && <div style={{ color: '#555', fontSize: '13px' }}>Loading...</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {creators.map(c => (
              <button key={c.id} onClick={() => setSelected(c)}
                style={{
                  width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: '8px',
                  background: selected?.id === c.id ? '#1a1a2e' : '#0a0a0a',
                  border: selected?.id === c.id ? '1px solid #2d2d4e' : '1px solid #1a1a1a',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}>
                <div style={{ fontSize: '13px', fontWeight: selected?.id === c.id ? 600 : 400, color: '#fff' }}>
                  {c.name || c.aka}
                </div>
                {c.aka && c.name && (
                  <div style={{ fontSize: '11px', color: '#555', marginTop: '1px' }}>{c.aka}</div>
                )}
                <div style={{ marginTop: '4px' }}>
                  <StatusPill status={c.profileAnalysisStatus === 'Complete' ? 'Analyzed' : (c.profileAnalysisStatus || 'Not Started')} />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Detail panel */}
        <div style={{ flex: 1, minWidth: 0, background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '12px', padding: '24px' }}>
          {!selected ? (
            <div style={{ color: '#555', fontSize: '13px', textAlign: 'center', padding: '60px 0' }}>
              Select a creator to view or build their profile.
            </div>
          ) : (
            <CreatorDetail
              key={selected.id}
              creator={selected}
              onProfileUpdated={handleProfileUpdated}
            />
          )}
        </div>
      </div>
    </div>
  )
}
