import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(232,160,160,0.08) 0%, transparent 50%), radial-gradient(ellipse 60% 80% at 80% 50%, rgba(196,122,122,0.04) 0%, transparent 50%), #060606' }}>
      <SignIn />
    </div>
  )
}
