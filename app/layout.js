import './globals.css'
import { Inter, Sora } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import Header from '@/components/Header'
import SuperAdminBar from '@/components/SuperAdminBar'
import GrainOverlay from '@/components/design/GrainOverlay'
import CursorGlow from '@/components/design/CursorGlow'
import SmoothScroll from '@/components/design/SmoothScroll'

const inter = Inter({
  variable: '--font-body',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
})

const sora = Sora({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
})

export const metadata = {
  title: 'Palm Management',
  description: 'Creator portal',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.png',
  },
  openGraph: {
    title: 'Palm Management',
    description: 'Creator portal',
    url: 'https://app.palm-mgmt.com',
    siteName: 'Palm',
    images: [
      {
        url: 'https://app.palm-mgmt.com/og-image.jpg',
        width: 1200,
        height: 630,
      },
    ],
  },
}

const clerkAppearance = {
  layout: {
    logoImageUrl: '/sign-in-logo.png',
    logoLinkUrl: '',
    socialButtonsVariant: 'iconButton',
  },
  variables: {
    colorPrimary: '#E8A0A0',
    colorBackground: '#0a0a0a',
    colorText: '#f0ece8',
    colorTextSecondary: 'rgba(240, 236, 232, 0.6)',
    colorInputBackground: 'rgba(255, 255, 255, 0.04)',
    colorInputText: '#f0ece8',
    fontFamily: 'var(--font-body), -apple-system, BlinkMacSystemFont, sans-serif',
    fontSize: '14px',
    borderRadius: '8px',
  },
  elements: {
    logoBox: { height: '60px' },
    logoImage: { height: '60px' },
    card: {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
      backdropFilter: 'blur(20px)',
      border: '1px solid rgba(255, 255, 255, 0.06)',
      borderRadius: '16px',
      boxShadow: 'inset 0 1px 0 0 rgba(255, 255, 255, 0.04)',
    },
    formButtonPrimary: {
      backgroundColor: '#E8A0A0',
      color: '#060606',
      fontWeight: '500',
      fontSize: '13px',
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      '&:hover': { backgroundColor: '#F5C6C6', boxShadow: '0 0 30px rgba(232, 160, 160, 0.3)' },
    },
    footerActionLink: { color: '#E8A0A0', fontWeight: '500' },
    headerTitle: { fontSize: '22px', fontWeight: '700', fontFamily: 'var(--font-display), sans-serif' },
    headerSubtitle: { fontSize: '14px', color: 'rgba(240, 236, 232, 0.6)' },
    socialButtonsBlockButton: {
      border: '1px solid rgba(255, 255, 255, 0.08)',
      backgroundColor: 'rgba(255, 255, 255, 0.02)',
      color: '#f0ece8',
      '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.04)', borderColor: 'rgba(232, 160, 160, 0.15)' },
    },
    formFieldLabel: { fontWeight: '500', fontSize: '13px', color: 'rgba(240, 236, 232, 0.8)' },
    formFieldInput: {
      backgroundColor: 'rgba(255, 255, 255, 0.04)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      color: '#f0ece8',
      '&:focus': { borderColor: 'rgba(232, 160, 160, 0.4)' },
    },
  },
}

export default function RootLayout({ children }) {
  return (
    <ClerkProvider appearance={clerkAppearance}>
      <html lang="en" className={`${inter.variable} ${sora.variable}`}>
        <body>
          <GrainOverlay />
          <CursorGlow />
          <SmoothScroll />
          <SuperAdminBar />
          <Header />
          {children}
        </body>
      </html>
    </ClerkProvider>
  )
}
