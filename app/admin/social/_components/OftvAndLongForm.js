'use client'

import { useState } from 'react'
import OftvProjectsQueue from '@/components/OftvProjectsQueue'
import LongFormUpload from '@/components/LongFormUpload'
import { Segmented } from './FilterBar'

// OftvAndLongForm — folds the former standalone "Long Form" tab into the OFTV
// area as a sub-switch (D1). OFTV Projects is a full revision workflow;
// Long Form is a simple uploader — both preserved, one declutters the other.
export default function OftvAndLongForm({ showToast }) {
  const [view, setView] = useState('oftv')
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Segmented
          value={view}
          onChange={setView}
          ariaLabel="OFTV projects or long-form upload"
          options={[{ value: 'oftv', label: 'OFTV Projects' }, { value: 'longform', label: 'Long Form' }]}
        />
      </div>
      {view === 'oftv'
        ? <OftvProjectsQueue showToast={showToast} role="admin" />
        : <LongFormUpload showToast={showToast} />}
    </div>
  )
}
