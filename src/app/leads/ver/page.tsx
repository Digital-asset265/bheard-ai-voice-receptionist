import { Suspense } from 'react'
import LeadViewClient from './LeadViewClient'

export default function Page() {
  return (
    <Suspense fallback={<main className="min-h-screen p-6">Loading lead...</main>}>
      <LeadViewClient />
    </Suspense>
  )
}
