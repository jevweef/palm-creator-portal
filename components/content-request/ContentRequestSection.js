'use client'

export default function ContentRequestSection({ name, description, itemCount, itemType }) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: 12,
      padding: '28px 32px',
      marginBottom: 20,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      border: '1px solid #eee',
    }}>
      <h2 style={{
        fontSize: 18,
        fontWeight: 700,
        color: '#1a1a1a',
        margin: '0 0 16px 0',
        textTransform: 'uppercase',
      }}>
        {name}
      </h2>
      {description && (
        <div style={{
          fontSize: 14,
          lineHeight: 1.7,
          color: '#444',
          whiteSpace: 'pre-wrap',
        }}>
          {description}
        </div>
      )}
      {itemType !== 'info_only' && itemCount > 0 && (
        <div style={{
          marginTop: 20,
          paddingTop: 16,
          borderTop: '1px solid #f0f0f0',
        }}>
          <button
            onClick={() => {
              // Scroll to first item
              const firstItem = document.querySelector('[data-upload-item]')
              if (firstItem) firstItem.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            style={{
              background: '#7c3aed',
              color: '#fff',
              border: 'none',
              padding: '10px 24px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            Continue &#8250;
          </button>
        </div>
      )}
    </div>
  )
}
