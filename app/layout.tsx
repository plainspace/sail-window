import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Dunmore',
  description: 'Lake Dunmore sailing conditions',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
