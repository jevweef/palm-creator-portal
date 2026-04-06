'use client'

export default function TonioPage() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{
          fontSize: '48px',
          fontWeight: 700,
          color: '#E88FAC',
          letterSpacing: '-0.02em',
          margin: 0,
        }}>
          Hi Tonio. 👋
        </h1>
        <p style={{ marginTop: '12px', color: '#999', fontSize: '15px' }}>
          Welcome to your dashboard.
        </p>
      </div>
    </div>
  )
}
