import './globals.css'
import { ClerkProvider } from '@clerk/nextjs'
import Header from '@/components/Header'
import SuperAdminBar from '@/components/SuperAdminBar'

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
    logoImageUrl: '/palm-logo.png',
    socialButtonsVariant: 'iconButton',
  },
  variables: {
    colorPrimary: '#E88FAC',
    colorBackground: '#0a0a0a',
    colorText: '#ffffff',
    colorTextSecondary: '#a1a1aa',
    colorInputBackground: '#111111',
    colorInputText: '#ffffff',
    borderRadius: '8px',
  },
  elements: {
    card: { backgroundColor: '#111', border: '1px solid #222', borderRadius: '12px' },
    headerTitle: { color: '#fff' },
    headerSubtitle: { color: '#71717a' },
    formButtonPrimary: { backgroundColor: '#E88FAC', color: '#fff', '&:hover': { backgroundColor: '#d4789a' } },
    footerActionLink: { color: '#E88FAC' },
    dividerLine: { backgroundColor: '#333' },
    dividerText: { color: '#555' },
    formFieldLabel: { color: '#d4d4d8' },
    formFieldInput: { backgroundColor: '#0a0a0a', borderColor: '#333', color: '#fff' },
    socialButtonsBlockButton: { backgroundColor: '#1a1a1a', border: '1px solid #333', color: '#fff', '&:hover': { backgroundColor: '#222' } },
    footerPagesLink: { color: '#71717a' },
  },
}

export default function RootLayout({ children }) {
  return (
    <ClerkProvider appearance={clerkAppearance}>
      <html lang="en">
        <body>
          <SuperAdminBar />
          <Header />
          {children}
        </body>
      </html>
    </ClerkProvider>
  )
}
