'use client'

import { useState } from 'react'
import TodayView from './_warmup/TodayView'
import AccountView from './_warmup/AccountView'
import NewAccountForm from './_warmup/NewAccountForm'

// Warm-Up tab — three views dispatched via local state:
//   today    → list of active accounts with today's tasks
//   account  → per-account drill-in (full task schedule, profile, controls)
//   new      → create-account form
//
// The outer tab key (?tab=warmup) doesn't change between sub-views — we
// stay inside the AI Content tab strip the entire time.
export default function WarmupTab() {
  const [view, setView] = useState({ name: 'today' })

  if (view.name === 'account') {
    return (
      <AccountView
        accountId={view.accountId}
        onBack={() => setView({ name: 'today' })}
      />
    )
  }
  if (view.name === 'new') {
    return (
      <NewAccountForm
        onCancel={() => setView({ name: 'today' })}
        onCreated={(id) => setView({ name: 'account', accountId: id })}
      />
    )
  }
  return (
    <TodayView
      onOpenAccount={(id) => setView({ name: 'account', accountId: id })}
      onCreateAccount={() => setView({ name: 'new' })}
    />
  )
}
