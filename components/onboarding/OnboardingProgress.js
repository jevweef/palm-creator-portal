'use client'

const STEPS = [
  { key: 'basic-info', label: 'Basic Info' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'survey', label: 'Survey' },
  { key: 'contract', label: 'Contract' },
  { key: 'voice-memo', label: 'Voice Memo' },
  { key: 'review', label: 'Review' },
]

export default function OnboardingProgress({ currentStep, completedSteps = [], onStepClick }) {
  const currentIndex = STEPS.findIndex(s => s.key === currentStep)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0', marginBottom: '32px' }}>
      {STEPS.map((step, i) => {
        const isActive = step.key === currentStep
        const isCompleted = completedSteps.includes(step.key) || i < currentIndex
        const isLast = i === STEPS.length - 1
        const clickable = !!onStepClick

        return (
          <div key={step.key} style={{ display: 'flex', alignItems: 'center', flex: isLast ? '0 0 auto' : '1 1 0' }}>
            <div
              onClick={() => clickable && onStepClick(step.key)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', minWidth: '72px', cursor: clickable ? 'pointer' : 'default' }}
            >
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '13px',
                fontWeight: 600,
                background: isCompleted ? 'var(--palm-pink)' : isActive ? 'rgba(232, 160, 160, 0.06)' : 'rgba(255,255,255,0.03)',
                color: isCompleted ? 'var(--foreground)' : isActive ? 'var(--palm-pink)' : '#999',
                border: isActive ? '1px solid var(--palm-pink)' : '2px solid transparent',
                transition: 'all 0.2s',
              }}>
                {isCompleted ? '✓' : i + 1}
              </div>
              <span style={{
                fontSize: '11px',
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--foreground)' : isCompleted ? 'var(--palm-pink)' : '#999',
                textAlign: 'center',
                whiteSpace: 'nowrap',
              }}>
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div style={{
                flex: 1,
                height: '2px',
                background: isCompleted ? 'var(--palm-pink)' : '#eee',
                marginTop: '-18px',
                minWidth: '20px',
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export { STEPS }
