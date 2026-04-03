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
    logoImageUrl: '/sign-in-logo.png',
    logoLinkUrl: '',
    socialButtonsVariant: 'iconButton',
  },
  variables: {
    colorPrimary: '#E88FAC',
    colorBackground: '#F8D7DD',
    colorText: '#1a1a1a',
    colorTextSecondary: '#666',
    colorInputBackground: '#fff',
    colorInputText: '#1a1a1a',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: '14px',
    borderRadius: '8px',
  },
  elements: {
    logoBox: { height: '60px' },
    logoImage: { height: '60px' },
    card: { backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' },
    formButtonPrimary: { backgroundColor: '#E88FAC', color: '#fff', fontWeight: '600', fontSize: '14px', '&:hover': { backgroundColor: '#d4789a' } },
    footerActionLink: { color: '#E88FAC', fontWeight: '500' },
    headerTitle: { fontSize: '22px', fontWeight: '700' },
    headerSubtitle: { fontSize: '14px', color: '#888' },
    socialButtonsBlockButton: { border: '1px solid #ddd', '&:hover': { backgroundColor: '#f5f5f5' } },
    formFieldLabel: { fontWeight: '600', fontSize: '13px' },
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
