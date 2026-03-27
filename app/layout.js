import './globals.css'
import { ClerkProvider } from '@clerk/nextjs'

export const metadata = {
  title: 'Palm Management',
  description: 'Creator portal',
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
        <body>{children}</body>
      </html>
    </ClerkProvider>
  )
}
