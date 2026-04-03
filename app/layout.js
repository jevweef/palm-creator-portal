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

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
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
