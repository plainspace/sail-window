import 'overlayscrollbars/styles/overlayscrollbars.css'
import './dunmore.css'

export const metadata = {
  title: 'When can I sail?',
  description:
    'A yes-or-no read on when conditions allow sailing at a spot, from the US National Weather Service forecast.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
