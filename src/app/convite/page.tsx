import { Suspense } from 'react'
import ConviteClient from './ConviteClient'

export default function ConvitePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center">
          <p className="text-lg">A carregar convite...</p>
        </main>
      }
    >
      <ConviteClient />
    </Suspense>
  )
}
