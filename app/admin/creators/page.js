'use client'

import { useState, useEffect, useRef } from 'react'

const TAG_CATEGORIES = [
  'Setting / Location',
  'Persona / Niche',
  'Tone / Energy',
  'Visual / Body',
  'Viewer Experience',
  'Film Format',
]

const STATUS_STYLES = {
  'Not Started':       { bg: '#FFF0F3', text: '#999', border: '#E8C4CC' },
  'Ready to Analyze':  { bg: '#dbeafe', text: '#60a5fa', border: '#bfdbfe' },
  'Analyzing':         { bg: '#fef3c7', text: '#f59e0b', border: '#fde68a' },
  'Analyzed':          { bg: '#dcfce7', text: '#22c55e', border: '#bbf7d0' },
  'Reanalyze':         { bg: '#ffedd5', text: '#fb923c', border: '#fed7aa' },
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
    'Persona / Niche':    '#E88FAC',
    'Tone / Energy':      '#f472b6',
    'Visual / Body':      '#fb923c',
    'Viewer Experience':  '#60a5fa',
    'Film Format':        '#34d399',
  }
  const color = catColors[category] || '#E88FAC'
  return (
    <div style={{ marginBottom: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
        <span style={{ fontSize: '12px', color: '#4a4a4a' }}>{tag}</span>
        <span style={{ fontSize: '12px', fontWeight: 600, color, minWidth: '28px', textAlign: 'right' }}>{weight}</span>
      </div>
      <div style={{ height: '4px', background: 'rgba(0,0,0,0.04)', borderRadius: '2px', overflow: 'hidden' }}>
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
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>{cat}</div>
            {tags.map(tw => (
              <WeightBar key={tw.tag} tag={tw.tag} weight={tw.weight} category={cat} />
            ))}
          </div>
        )
      })}
    </div>
  )
}

function DocumentRow({ doc, isNew }) {
  const typeColors = {
    Audio: '#E88FAC', Transcript: '#60a5fa', PDF: '#fb923c',
    'Meeting Notes': '#34d399', Other: '#999',
  }
  const color = typeColors[doc.fileType] || '#999'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '10px 12px', background: isNew ? '#FFFBEB' : '#ffffff', borderRadius: '8px',
      border: isNew ? '1px solid #FDE68A' : 'none',
      boxShadow: isNew ? 'none' : '0 2px 12px rgba(0,0,0,0.06)',
    }}>
      <span style={{ fontSize: '11px', fontWeight: 600, color, background: '#FFF0F3', border: `1px solid ${color}30`, padding: '2px 6px', borderRadius: '4px', flexShrink: 0 }}>
        {doc.fileType}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '13px', color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.fileName}</span>
          {isNew && (
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#d97706', background: '#FEF3C7', border: '1px solid #FDE68A', padding: '1px 6px', borderRadius: '4px', flexShrink: 0 }}>
              New
            </span>
          )}
        </div>
        {doc.notes && <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>{doc.notes}</div>}
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
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#ffffff', border: 'none', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', borderRadius: '18px', padding: '28px', width: '480px', maxWidth: '95vw' }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: '#1a1a1a', marginBottom: '20px' }}>
          Upload Document — {creator.name || creator.aka}
        </div>

        {result ? (
          <div>
            <div style={{ color: '#22c55e', fontSize: '14px', marginBottom: '12px' }}>
              Uploaded successfully.{result.isAudio ? ' Audio will be transcribed when you run analysis.' : ''}
            </div>
            <div style={{ fontSize: '12px', color: '#999', marginBottom: '20px' }}>{result.fileName}</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => { setResult(null); setFile(null); setNotes('') }}
                style={{ flex: 1, background: '#FFF0F3', color: '#1a1a1a', border: '1px solid #E8C4CC', borderRadius: '6px', padding: '8px', cursor: 'pointer', fontSize: '13px' }}>
                Upload Another
              </button>
              <button onClick={() => { onUploaded(); onClose() }}
                style={{ flex: 1, background: '#E88FAC', color: '#1a1a1a', border: 'none', borderRadius: '6px', padding: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', color: '#999', display: 'block', marginBottom: '6px' }}>File Type</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {['Audio', 'Transcript', 'PDF', 'Meeting Notes', 'Other'].map(t => (
                  <button key={t} onClick={() => setFileType(t)}
                    style={{
                      padding: '6px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
                      background: fileType === t ? '#E88FAC' : '#FFF0F3',
                      color: fileType === t ? '#fff' : '#888',
                      border: fileType === t ? '1px solid #E88FAC' : '1px solid #E8C4CC',
                    }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', color: '#999', display: 'block', marginBottom: '6px' }}>File</label>
              <div
                onClick={() => fileRef.current?.click()}
                style={{
                  border: '1px dashed #E8C4CC', borderRadius: '8px', padding: '20px', textAlign: 'center',
                  cursor: 'pointer', background: file ? '#dcfce7' : '#FFF5F7', color: file ? '#16a34a' : '#999', fontSize: '13px', fontWeight: file ? 600 : 400,
                }}>
                {file ? file.name : 'Click to select a file'}
              </div>
              <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0])} />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '12px', color: '#999', display: 'block', marginBottom: '6px' }}>Notes (optional)</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Onboarding call Jan 2026"
                style={{ width: '100%', background: '#FFF5F7', border: '1px solid #E8C4CC', borderRadius: '6px', padding: '8px 10px', color: '#1a1a1a', fontSize: '13px', boxSizing: 'border-box' }} />
            </div>

            {error && <div style={{ color: '#ef4444', fontSize: '12px', marginBottom: '12px' }}>{error}</div>}

            {fileType === 'Audio' && (
              <div style={{ fontSize: '11px', color: '#999', marginBottom: '16px', padding: '8px 10px', background: '#FFF5F7', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '6px' }}>
                Audio uploads directly to Dropbox. Whisper transcription runs when you hit "Run Analysis."
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={onClose}
                style={{ flex: 1, background: '#FFF0F3', color: '#888', border: '1px solid #E8C4CC', borderRadius: '6px', padding: '8px', cursor: 'pointer', fontSize: '13px' }}>
                Cancel
              </button>
              <button onClick={submit} disabled={uploading || !file}
                style={{
                  flex: 2, background: uploading ? '#E8C4CC' : '#E88FAC', color: '#1a1a1a', border: 'none',
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
  const [refining, setRefining] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [analyzeResult, setAnalyzeResult] = useState(null)
  const [refineResult, setRefineResult] = useState(null)
  const [refinePreview, setRefinePreview] = useState(null)
  const [analyzeError, setAnalyzeError] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [activeTab, setActiveTab] = useState('profile')
  const [feedback, setFeedback] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/creator-profile?creatorId=${creator.id}`)
      const data = await res.json()
      setProfile(data)
      if (data?.creator?.adminFeedback) setFeedback(data.creator.adminFeedback)
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

  const runRefine = async () => {
    if (!feedback.trim()) return
    setRefining(true)
    setAnalyzeError('')
    setRefineResult(null)
    setRefinePreview(null)
    try {
      const res = await fetch('/api/admin/creator-profile/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: creator.id, feedback: feedback.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Refine failed')
      setRefinePreview(data)
    } catch (e) {
      setAnalyzeError(e.message)
    } finally {
      setRefining(false)
    }
  }

  const commitRefine = async () => {
    if (!refinePreview?.proposed) return
    setCommitting(true)
    setAnalyzeError('')
    try {
      const res = await fetch('/api/admin/creator-profile/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId: creator.id,
          feedback: feedback.trim(),
          commit: true,
          proposal: refinePreview.proposed,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Commit failed')
      setRefineResult({ changesMade: refinePreview.changesMade })
      setRefinePreview(null)
      load()
      onProfileUpdated(creator.id, 'Complete')
    } catch (e) {
      setAnalyzeError(e.message)
    } finally {
      setCommitting(false)
    }
  }

  const discardRefine = () => {
    setRefinePreview(null)
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: '#555', fontSize: '13px' }}>
      Loading...
    </div>
  )

  const { documents = [], tagWeights = [] } = profile || {}
  const c = profile?.creator || {}

  const status = getDisplayStatus(c.profileAnalysisStatus, documents, c.profileLastAnalyzed, analyzing)
  const topTags = [...tagWeights].filter(tw => tw.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, 5)

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a' }}>{creator.name}</div>
          {creator.aka && <div style={{ fontSize: '13px', color: '#999', marginTop: '2px' }}>aka {creator.aka}</div>}
          <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <StatusPill status={status} />
            {c.profileLastAnalyzed && (
              <span style={{ fontSize: '11px', color: '#555' }}>Last analyzed {c.profileLastAnalyzed}</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
          <button onClick={() => setShowUpload(true)}
            style={{ background: '#FFF0F3', color: '#1a1a1a', border: '1px solid #E8C4CC', borderRadius: '6px', padding: '7px 14px', fontSize: '12px', cursor: 'pointer', fontWeight: 500 }}>
            + Upload
          </button>
          {(status === 'Analyzed' || status === 'Reanalyze' || status === 'Analyzing') && (
            <button onClick={resetAnalysis} disabled={resetting}
              style={{
                background: '#FFF0F3', color: '#999', border: '1px solid #E8C4CC',
                borderRadius: '6px', padding: '7px 14px', fontSize: '12px', fontWeight: 500,
                cursor: resetting ? 'not-allowed' : 'pointer', opacity: resetting ? 0.5 : 1,
              }}>
              {resetting ? 'Resetting...' : 'Reset'}
            </button>
          )}
          <button onClick={runAnalysis} disabled={analyzing}
            style={{
              background: analyzing ? '#E8C4CC' : '#E88FAC', color: '#1a1a1a', border: 'none',
              borderRadius: '6px', padding: '7px 16px', fontSize: '12px', fontWeight: 600,
              cursor: analyzing ? 'not-allowed' : 'pointer', opacity: analyzing ? 0.7 : 1,
            }}>
            {analyzing ? 'Analyzing...' : (status === 'Analyzed' || status === 'Reanalyze' ? 'Reanalyze' : 'Run Analysis')}
          </button>
        </div>
      </div>

      {analyzeResult && (
        <div style={{ background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: '#22c55e' }}>
          Analysis complete. {analyzeResult.documentsAnalyzed} document(s) analyzed.
          {analyzeResult.topTags?.length > 0 && (
            <span style={{ color: '#888' }}> Top tags: {analyzeResult.topTags.map(t => `${t.tag} (${t.weight})`).join(', ')}</span>
          )}
        </div>
      )}

      {refineResult && (
        <div style={{ background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: '#22c55e' }}>
          Profile refined.{refineResult.changesMade && <span style={{ color: '#888' }}> {refineResult.changesMade}</span>}
        </div>
      )}

      {analyzeError && (
        <div style={{ background: '#FFF0F3', border: '1px solid #E8C4CC', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: '#ef4444' }}>
          {analyzeError}
        </div>
      )}

      {/* Refine Preview */}
      {refinePreview && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px', gap: '16px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a' }}>Review Proposed Changes</div>
              {refinePreview.changesMade && (
                <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>{refinePreview.changesMade}</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
              <button onClick={discardRefine}
                style={{ background: '#FFF0F3', color: '#999', border: '1px solid #E8C4CC', borderRadius: '6px', padding: '7px 14px', fontSize: '12px', fontWeight: 500, cursor: 'pointer' }}>
                Discard
              </button>
              <button onClick={commitRefine} disabled={committing}
                style={{
                  background: committing ? '#bbf7d0' : '#22c55e', color: '#fff', border: 'none',
                  borderRadius: '6px', padding: '7px 16px', fontSize: '12px', fontWeight: 600,
                  cursor: committing ? 'not-allowed' : 'pointer',
                }}>
                {committing ? 'Saving...' : 'Accept & Save'}
              </button>
            </div>
          </div>

          {/* Profile text diffs */}
          {[
            ['Profile Summary', 'profileSummary', 'profile_summary'],
            ['Brand Voice', 'brandVoiceNotes', 'brand_voice_notes'],
            ['Content Direction', 'contentDirectionNotes', 'content_direction_notes'],
            ['Do / Don\'t', 'dosDonts', 'do_dont_notes'],
          ].map(([label, currentKey, proposedKey]) => {
            const cur = refinePreview.current?.[currentKey] || ''
            const proposed = refinePreview.proposed?.[proposedKey] || ''
            if (cur === proposed) return null
            return (
              <div key={label} style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>{label}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div style={{ background: '#FEF2F2', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#991B1B', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                    <div style={{ fontSize: '10px', fontWeight: 600, color: '#DC2626', marginBottom: '6px' }}>CURRENT</div>
                    {cur || <span style={{ color: '#999', fontStyle: 'italic' }}>empty</span>}
                  </div>
                  <div style={{ background: '#F0FDF4', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#166534', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                    <div style={{ fontSize: '10px', fontWeight: 600, color: '#16A34A', marginBottom: '6px' }}>PROPOSED</div>
                    {proposed || <span style={{ color: '#999', fontStyle: 'italic' }}>empty</span>}
                  </div>
                </div>
              </div>
            )
          })}

          {/* Tag weight diffs — only show tags that changed */}
          {(() => {
            const curTags = refinePreview.current?.tagWeights || {}
            const propTags = refinePreview.proposed?.tag_weights || {}
            const allTags = new Set([...Object.keys(curTags), ...Object.keys(propTags)])
            const changed = [...allTags].filter(t => (curTags[t] || 0) !== (propTags[t] || 0))
              .sort((a, b) => Math.abs((propTags[b] || 0) - (curTags[b] || 0)) - Math.abs((propTags[a] || 0) - (curTags[a] || 0)))
            if (changed.length === 0) return (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Tag Weight Changes</div>
                <div style={{ fontSize: '12px', color: '#999', fontStyle: 'italic' }}>No tag weight changes — only profile text was adjusted.</div>
              </div>
            )
            const maxDelta = Math.max(...changed.map(t => Math.abs((propTags[t] || 0) - (curTags[t] || 0))), 1)
            return (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>Tag Weight Changes</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {changed.map(tag => {
                    const from = curTags[tag] || 0
                    const to = propTags[tag] || 0
                    const diff = to - from
                    const barPct = Math.abs(diff) / maxDelta * 45
                    return (
                      <div key={tag} style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
                        {/* Tag name */}
                        <span style={{ fontSize: '12px', color: '#4a4a4a', width: '160px', flexShrink: 0, textAlign: 'right', paddingRight: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
                        {/* From value */}
                        <span style={{ fontSize: '11px', color: '#999', width: '28px', textAlign: 'right', flexShrink: 0 }}>{from}</span>
                        {/* Diverging bar */}
                        <div style={{ flex: 1, height: '20px', position: 'relative', margin: '0 8px' }}>
                          {/* Center line */}
                          <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: '#ddd' }} />
                          {/* Bar */}
                          {diff > 0 ? (
                            <div style={{
                              position: 'absolute', left: '50%', top: '3px', height: '14px',
                              width: `${barPct}%`, background: '#22c55e', borderRadius: '0 4px 4px 0',
                              transition: 'width 0.3s ease',
                            }} />
                          ) : (
                            <div style={{
                              position: 'absolute', right: '50%', top: '3px', height: '14px',
                              width: `${barPct}%`, background: '#ef4444', borderRadius: '4px 0 0 4px',
                              transition: 'width 0.3s ease',
                            }} />
                          )}
                        </div>
                        {/* To value */}
                        <span style={{ fontSize: '11px', fontWeight: 600, color: diff > 0 ? '#16a34a' : '#dc2626', width: '28px', textAlign: 'left', flexShrink: 0 }}>{to}</span>
                        {/* Delta */}
                        <span style={{ fontSize: '11px', fontWeight: 600, color: diff > 0 ? '#16a34a' : '#dc2626', width: '36px', textAlign: 'right', flexShrink: 0 }}>
                          {diff > 0 ? '+' : ''}{diff}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* Tabs — hidden during refine preview */}
      {!refinePreview && <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid rgba(0,0,0,0.04)', marginBottom: '20px' }}>
        {[['profile', 'Profile'], ['documents', `Documents (${documents.length})`], ['tags', 'Tag Weights']].map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key)}
            style={{
              padding: '8px 16px', fontSize: '13px', fontWeight: activeTab === key ? 600 : 400,
              color: activeTab === key ? '#1a1a1a' : '#999', background: 'none', border: 'none',
              borderBottom: activeTab === key ? '2px solid #E88FAC' : '2px solid transparent',
              cursor: 'pointer', marginBottom: '-1px',
            }}>
            {label}
          </button>
        ))}
      </div>}

      {/* Profile tab */}
      {!refinePreview && activeTab === 'profile' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {!c.profileSummary && status !== 'Analyzed' && status !== 'Reanalyze' && (
            <div style={{ color: '#555', fontSize: '13px', padding: '12px', background: '#ffffff', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.04)' }}>
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
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>Top Tags</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {topTags.map(tw => (
                  <span key={tw.tag} style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 500, background: '#FFF0F3', color: '#E88FAC', border: '1px solid rgba(0,0,0,0.04)' }}>
                    {tw.tag} · {tw.weight}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Admin Feedback + Refine */}
          {(status === 'Analyzed' || status === 'Reanalyze') && (
            <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: '20px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Admin Feedback</div>
              <textarea
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                placeholder="e.g. she's more bratty than sweet, tone down Girl Next Door, bump up Soft Tease"
                rows={3}
                style={{
                  width: '100%', background: '#FFF5F7', border: '1px solid #E8C4CC', borderRadius: '8px',
                  padding: '10px 12px', color: '#1a1a1a', fontSize: '13px', lineHeight: '1.5',
                  resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit',
                }}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center' }}>
                <button
                  onClick={runRefine}
                  disabled={refining || !feedback.trim()}
                  style={{
                    background: refining ? '#E8C4CC' : '#E88FAC', color: '#1a1a1a', border: 'none',
                    borderRadius: '6px', padding: '7px 16px', fontSize: '12px', fontWeight: 600,
                    cursor: refining || !feedback.trim() ? 'not-allowed' : 'pointer',
                    opacity: !feedback.trim() ? 0.5 : 1,
                  }}
                >
                  {refining ? 'Refining...' : 'Refine'}
                </button>
                <span style={{ fontSize: '11px', color: '#999' }}>
                  Adjusts the current profile based on your feedback — does not re-process documents.
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Documents tab */}
      {!refinePreview && activeTab === 'documents' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {documents.length === 0 && (
            <div style={{ color: '#555', fontSize: '13px', padding: '12px', background: '#ffffff', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.04)' }}>
              No documents yet. Click "+ Upload" to add voice memos, transcripts, or notes.
            </div>
          )}
          {documents.some(doc => c.profileLastAnalyzed && doc.uploadDate > c.profileLastAnalyzed) && (
            <div style={{ fontSize: '11px', color: '#d97706', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '6px', padding: '6px 10px' }}>
              Yellow docs were uploaded after the last analysis and are not yet included. Hit Reanalyze to pick them up.
            </div>
          )}
          {documents.map(doc => (
            <DocumentRow key={doc.id} doc={doc} isNew={!!(c.profileLastAnalyzed && doc.uploadDate > c.profileLastAnalyzed)} />
          ))}
          <button onClick={() => setShowUpload(true)}
            style={{ marginTop: '4px', background: '#FFF5F7', color: '#999', border: '1px dashed #E8C4CC', borderRadius: '8px', padding: '10px', fontSize: '13px', cursor: 'pointer' }}>
            + Upload another document
          </button>
        </div>
      )}

      {/* Tag weights tab */}
      {!refinePreview && activeTab === 'tags' && (
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
      <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>{label}</div>
      <div style={{
        fontSize: '13px', color: '#4a4a4a', lineHeight: '1.6', whiteSpace: 'pre-wrap',
        fontFamily: mono ? 'monospace' : 'inherit', background: '#ffffff',
        borderRadius: '8px', padding: '12px 14px', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
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
        <div style={{ fontSize: '22px', fontWeight: 700, color: '#1a1a1a' }}>Creator Profiles</div>
        <div style={{ fontSize: '13px', color: '#999', marginTop: '4px' }}>Upload documents and generate AI-powered creator profiles and tag weights.</div>
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
        {/* Creator list */}
        <div style={{ width: '220px', flexShrink: 0 }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Creators</div>
          {loading && <div style={{ color: '#555', fontSize: '13px' }}>Loading...</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {creators.map(c => (
              <button key={c.id} onClick={() => setSelected(c)}
                style={{
                  width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: '8px',
                  background: selected?.id === c.id ? '#ffffff' : 'transparent',
                  border: selected?.id === c.id ? '1px solid #E88FAC' : '1px solid transparent',
                  boxShadow: selected?.id === c.id ? '0 2px 12px rgba(0,0,0,0.06)' : 'none',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}>
                <div style={{ fontSize: '13px', fontWeight: selected?.id === c.id ? 600 : 400, color: '#1a1a1a' }}>
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
        <div style={{ flex: 1, minWidth: 0, background: '#ffffff', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px', padding: '24px' }}>
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
