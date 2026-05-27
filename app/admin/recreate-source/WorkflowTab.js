'use client'

import Link from 'next/link'

// Placeholder for the AI workflow tab. Today this links out to the existing
// /ai-editor surface (the AI editor's TJP-feeding workspace). A future batch
// may inline that page's content directly into this tab — see
// docs/build-plans/smm-consolidation/batch-1-nav-consolidation.md
// "Open questions" #1.
export default function WorkflowTab() {
  return (
    <div style={{ padding: 32, maxWidth: 760 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>AI Workflow</h2>
      <p style={{ marginTop: 12, color: 'var(--foreground-muted)', lineHeight: 1.5 }}>
        Pick reels, run image-to-image in TJP, batch upload finished videos, and handle revisions.
        This is the same workspace the AI editor uses day-to-day.
      </p>

      <Link
        href="/ai-editor"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 20,
          padding: '11px 20px',
          background: 'var(--palm-pink)',
          color: '#fff',
          borderRadius: 8,
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        Open AI Workflow
        <span aria-hidden style={{ fontSize: 16 }}>→</span>
      </Link>

      <p style={{ marginTop: 28, color: 'var(--foreground-subtle)', fontSize: 12, lineHeight: 1.5 }}>
        Note: this button opens <code>/ai-editor</code> in the same tab. A future batch may inline
        the workflow here so both admin and AI editor see one consolidated surface — see the SMM
        consolidation plan for context.
      </p>
    </div>
  )
}
