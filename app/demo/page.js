import EarningsGrowth from '@/components/marketing/EarningsGrowth'

export default function DemoPage() {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#0a0a0a',
      overflowY: 'auto',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '60px 24px',
      gap: 32,
    }}>
      <p style={{
        color: 'rgba(255,255,255,0.4)', fontSize: 13,
        fontWeight: 500, letterSpacing: 2, textTransform: 'uppercase',
      }}>
        Real results. Real creators.
      </p>

      <EarningsGrowth />

      <p style={{
        color: 'rgba(255,255,255,0.25)', fontSize: 12,
        marginTop: 8,
      }}>
        Scroll down or hover the chart to interact
      </p>
    </div>
  )
}
