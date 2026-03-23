import './globals.css'

export const metadata = {
  title: 'Palm Inspo Board',
  description: 'Creator inspiration portal',
  openGraph: {
    title: 'Palm Inspo Board',
    description: 'Creator inspiration portal',
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
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
