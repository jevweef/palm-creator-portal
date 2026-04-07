'use client'

import { useState, useEffect, useRef } from 'react'

export default function StepContract({ hqId, onComplete }) {
  const [contractHtml, setContractHtml] = useState(null)
  const [loading, setLoading] = useState(true)
  const [signMode, setSignMode] = useState(null) // 'draw' | 'type'
  const [typedName, setTypedName] = useState('')
  const [signing, setSigning] = useState(false)
  const [signed, setSigned] = useState(false)
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null)
  const [pdfFilename, setPdfFilename] = useState('contract.pdf')
  const canvasRef = useRef(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)

  useEffect(() => {
    if (!hqId) return
    fetch(`/api/onboarding/contract/generate?hqId=${hqId}`)
      .then(r => r.json())
      .then(data => {
        setContractHtml(data.html || '')
        // If already signed, show the signed state
        if (data.alreadySigned && data.contractUrl) {
          setSigned(true)
          setPdfBlobUrl(data.contractUrl)
          setPdfFilename(data.contractFilename || 'contract.pdf')
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [hqId])

  // Canvas drawing handlers
  const getPos = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  const startDraw = (e) => {
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const pos = getPos(e)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    setIsDrawing(true)
  }

  const draw = (e) => {
    if (!isDrawing) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const pos = getPos(e)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#000'
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    setHasDrawn(true)
  }

  const endDraw = () => setIsDrawing(false)

  const clearCanvas = () => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawn(false)
  }

  const handleSign = async () => {
    setSigning(true)
    try {
      let signatureDataUrl = null
      let name = null

      if (signMode === 'draw' && canvasRef.current) {
        signatureDataUrl = canvasRef.current.toDataURL('image/png')
      }
      if (signMode === 'type') {
        name = typedName
      }

      const res = await fetch('/api/onboarding/contract/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId, signatureDataUrl, signedName: name || typedName || '' }),
      })

      const data = await res.json()
      if (res.ok) {
        setSigned(true)
        if (data.pdfBase64) {
          const byteChars = atob(data.pdfBase64)
          const byteArray = new Uint8Array(byteChars.length)
          for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i)
          const blob = new Blob([byteArray], { type: 'application/pdf' })
          setPdfBlobUrl(URL.createObjectURL(blob))
        }
        if (data.filename) setPdfFilename(data.filename)
      }
    } catch (err) {
      console.error('Sign error:', err)
    } finally {
      setSigning(false)
    }
  }

  const canSign = signMode === 'draw' ? hasDrawn : signMode === 'type' ? typedName.length > 0 : false

  if (loading) {
    return <div style={{ color: '#999', fontSize: '14px', padding: '20px' }}>Loading contract...</div>
  }

  if (signed) {
    return (
      <div>
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#E8F5E9', padding: '8px 16px', borderRadius: '8px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#2E7D32"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#2E7D32' }}>Contract Signed Successfully</span>
          </div>
        </div>

        {/* Show the signed PDF */}
        {pdfBlobUrl && (
          <div style={{
            background: '#fff',
            border: '1px solid #e0e0e0',
            borderRadius: '12px',
            overflow: 'hidden',
            marginBottom: '20px',
          }}>
            <iframe
              src={pdfBlobUrl}
              style={{
                width: '100%',
                height: '600px',
                border: 'none',
              }}
              title="Signed Contract PDF"
            />
          </div>
        )}

        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '13px', color: '#999', marginBottom: '16px' }}>
            Your signed contract has been saved.
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            {pdfBlobUrl && (
              <a
                href={pdfBlobUrl}
                download={pdfFilename}
                style={{
                  padding: '10px 24px',
                  background: '#fff',
                  color: '#E88FAC',
                  border: '1px solid #E88FAC',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textDecoration: 'none',
                  display: 'inline-block',
                }}
              >
                Download PDF
              </a>
            )}
            <button
              onClick={onComplete}
              style={{
                padding: '10px 32px',
                background: '#E88FAC',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>
        Contract
      </h2>
      <p style={{ fontSize: '13px', color: '#999', marginBottom: '20px' }}>
        Please read the agreement below, then sign at the bottom.
      </p>

      {/* Contract preview */}
      <div style={{
        background: '#fff',
        border: '1px solid #e0e0e0',
        borderRadius: '12px',
        maxHeight: '500px',
        overflow: 'auto',
        marginBottom: '24px',
        padding: '0',
      }}>
        <iframe
          srcDoc={contractHtml}
          style={{
            width: '100%',
            height: '500px',
            border: 'none',
            borderRadius: '12px',
          }}
          title="Contract Preview"
        />
      </div>

      {/* Signature section */}
      <div style={{
        background: '#fff',
        border: '1px solid #e0e0e0',
        borderRadius: '12px',
        padding: '20px',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a', marginBottom: '12px' }}>
          Sign Below
        </div>

        {/* Mode selector */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button
            type="button"
            onClick={() => setSignMode('draw')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: signMode === 'draw' ? '2px solid #E88FAC' : '2px solid #e0e0e0',
              background: signMode === 'draw' ? '#FFF0F3' : '#fff',
              color: signMode === 'draw' ? '#E88FAC' : '#666',
              fontSize: '13px',
              fontWeight: signMode === 'draw' ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            Draw Signature
          </button>
          <button
            type="button"
            onClick={() => setSignMode('type')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: signMode === 'type' ? '2px solid #E88FAC' : '2px solid #e0e0e0',
              background: signMode === 'type' ? '#FFF0F3' : '#fff',
              color: signMode === 'type' ? '#E88FAC' : '#666',
              fontSize: '13px',
              fontWeight: signMode === 'type' ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            Type Name
          </button>
        </div>

        {signMode === 'draw' && (
          <div>
            <canvas
              ref={canvasRef}
              width={600}
              height={160}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
              style={{
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                cursor: 'crosshair',
                maxWidth: '100%',
                touchAction: 'none',
              }}
            />
            <button
              type="button"
              onClick={clearCanvas}
              style={{
                marginTop: '8px',
                padding: '4px 12px',
                background: '#f5f5f5',
                border: 'none',
                borderRadius: '6px',
                fontSize: '11px',
                color: '#999',
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
          </div>
        )}

        {signMode === 'type' && (
          <div>
            <input
              type="text"
              value={typedName}
              onChange={e => setTypedName(e.target.value)}
              placeholder="Type your full legal name"
              style={{
                width: '100%',
                maxWidth: '400px',
                padding: '12px 16px',
                fontSize: '20px',
                fontFamily: "'Georgia', serif",
                fontStyle: 'italic',
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                outline: 'none',
              }}
            />
          </div>
        )}

        {signMode && (
          <button
            onClick={handleSign}
            disabled={!canSign || signing}
            style={{
              marginTop: '16px',
              padding: '10px 32px',
              background: !canSign || signing ? '#F0D0D8' : '#E88FAC',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: !canSign || signing ? 'not-allowed' : 'pointer',
            }}
          >
            {signing ? 'Signing...' : 'Sign & Submit Contract'}
          </button>
        )}
      </div>
    </div>
  )
}
