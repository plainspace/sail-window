import 'overlayscrollbars/styles/overlayscrollbars.css'

export const metadata = {
  title: 'When can I sail at Lake Dunmore?',
  description: 'A yes-or-no read on when conditions allow sailing at Lake Dunmore, Vermont.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
