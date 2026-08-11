export const metadata = { title: 'Dunmore', description: 'When can I sail at Lake Dunmore' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
