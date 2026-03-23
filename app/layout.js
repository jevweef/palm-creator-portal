import './globals.css'

export const metadata = {
  title: 'Palm Inspo Board',
  description: 'Creator inspiration portal',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
