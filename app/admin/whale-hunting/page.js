'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'

export default function WhaleHuntingPage() {
  const router = useRouter()
  const pathname = usePathname()
  const [tab, setTab] = useState('internal')

  // Read tab from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('tab')
    if (t === 'internal' || t === 'team') setTab(t)
  }, [])

  function switchTab(key) {
    setTab(key)
    router.replace(`${pathname}?tab=${key}`, { scroll: false })
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>🐋 Whale Hunting</h1>
        <p style={{ fontSize: '13px', color: '#666', margin: '6px 0 0' }}>
          Aggregate reports across analyzed whales. Per-fan briefs live on each creator&apos;s Fans tab.
        </p>
      </div>

      {/* Tab headers */}
      <div style={{ display: 'flex', gap: '24px', borderBottom: '1px solid #E5E7EB', marginBottom: '24px' }}>
        {[
          { key: 'internal', label: 'Palm Internal' },
          { key: 'team', label: 'Chat Team Report' },
        ].map(t => (
          <button key={t.key} onClick={() => switchTab(t.key)}
            style={{
              padding: '10px 0', fontSize: '13px', fontWeight: tab === t.key ? 700 : 500,
              color: tab === t.key ? 'var(--foreground)' : 'var(--foreground-muted)',
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: tab === t.key ? '1px solid var(--palm-pink)' : '2px solid transparent',
              marginBottom: '-1px',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'internal' && <PalmInternalTab />}
      {tab === 'team' && <ChatTeamTab />}
    </div>
  )
}

function PalmInternalTab() {
  return (
    <div>
      <SectionCard
        title="Strategic visibility into whale performance across all creators"
        description="For Palm leadership. Cross-creator LTV curves, patron-tier churn, archetype distribution, pricing elasticity, content demand clusters, chat team health in aggregate."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginTop: '16px' }}>
        <ComingSoonCard
          title="Patron-Tier Retention"
          description="How many $3k+ fans stayed engaged this quarter across all creators. Who slipped, who held."
        />
        <ComingSoonCard
          title="Cross-Creator Revenue Attribution"
          description="Which creators, accounts, and archetype mixes drive revenue. Where the leaks are."
        />
        <ComingSoonCard
          title="Content Demand Clusters"
          description="What content types fans are asking for across all creators. Unmet demand, hot categories, shoot priorities."
        />
        <ComingSoonCard
          title="Pricing Elasticity"
          description="Where fans convert vs where they push back. Optimal PPV bands by archetype."
        />
        <ComingSoonCard
          title="Early Whale Signals"
          description="New subs on patron-tier trajectory based on first 30 days of behavior. Proactive whale identification."
        />
        <ComingSoonCard
          title="Chat Team Health (Aggregate)"
          description="Response times, mass-template usage rate, archetype-match rate, quote-back rate across the entire team."
        />
      </div>

      <div style={{
        marginTop: '32px', padding: '16px 20px', background: '#FEF9C3',
        border: '1px solid #FDE68A', borderRadius: '8px', fontSize: '12px', color: '#78350F',
      }}>
        <strong>Phase 1:</strong> Per-fan analysis format has been rebuilt with the new
        classification + dossier + diagnosis + prescription pipeline. This page will populate
        once we&apos;ve accumulated ~10-20 analyses in the new format — the reports aggregate over
        the structured data each brief produces.
      </div>
    </div>
  )
}

function ChatTeamTab() {
  return (
    <div>
      <SectionCard
        title="What gets sent to the chat manager"
        description="Pattern-level observations across the chat team's work. Diplomatic — focuses on behaviors, not individuals. Meant to give the manager evidence-backed coaching material."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginTop: '16px' }}>
        <ComingSoonCard
          title="Mass-Template Detection"
          description="Same script sent to multiple fans — including known whales. Which scripts, how many fans, revenue at risk."
        />
        <ComingSoonCard
          title="Pricing-vs-Budget Audit"
          description="Fans who stated a budget ceiling + got priced above it. Exact quotes, dates, pricing gaps."
        />
        <ComingSoonCard
          title="Archetype-Script Mismatches"
          description="Specific scripts sent to the wrong fan types (e.g. hardcore to romantic, humiliation to praise-seekers)."
        />
        <ComingSoonCard
          title="Quote-Back Rate"
          description="Creator messages that echo the fan's words without adding substance. Engagement-killer for relationship fans."
        />
        <ComingSoonCard
          title="Wins to Replicate"
          description="Where the team nailed it this period — specific interactions that converted. Training material."
        />
        <ComingSoonCard
          title="Anonymized Case Studies"
          description="2-3 deep-dives per period — what happened, what could have gone differently, lesson extracted. No individual chatter names."
        />
      </div>

      <div style={{
        marginTop: '32px', padding: '16px 20px', background: '#F3F4F6',
        border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '12px', color: '#374151',
      }}>
        <strong>Cadence:</strong> Weekly digest + monthly retrospective. Output is a single
        downloadable PDF/doc the chat manager can read on their own and use for coaching conversations.
      </div>
    </div>
  )
}

function SectionCard({ title, description }) {
  return (
    <div style={{
      padding: '20px 24px', background: 'var(--card-bg-solid)', borderRadius: '12px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.04)', border: '1px solid #F3F4F6',
    }}>
      <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a', marginBottom: '6px' }}>{title}</div>
      <div style={{ fontSize: '12px', color: '#666', lineHeight: '1.6' }}>{description}</div>
    </div>
  )
}

function ComingSoonCard({ title, description }) {
  return (
    <div style={{
      padding: '16px 18px', background: '#FAFAFA', borderRadius: '10px',
      border: '1px dashed #D1D5DB', position: 'relative',
    }}>
      <div style={{
        position: 'absolute', top: '10px', right: '12px', fontSize: '9px', fontWeight: 700,
        color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>Coming Soon</div>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>{title}</div>
      <div style={{ fontSize: '11px', color: '#666', lineHeight: '1.5' }}>{description}</div>
    </div>
  )
}
