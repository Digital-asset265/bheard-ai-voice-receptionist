import { Suspense } from 'react'
import RegistroClient from './RegistroClient'

export default function RegistroPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center">
          <p className="text-lg">A preparar registo...</p>
        </main>
      }
    >
      <RegistroClient />
    </Suspense>
  )
}
