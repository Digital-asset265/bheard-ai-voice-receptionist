'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabaseClient'

type Profile = {
  id: string
  role: string | null
}

type Restaurant = {
  id: string
  name: string
  email: string | null
}

// âœ… IMPORTANT: Supabase join may come as array
type RestaurantUserRow = {
  restaurants: Restaurant | Restaurant[] | null
}

export default function HomePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {

    const load = async () => {
      setLoading(true)
      setError(null)

      // âœ… 1) Check session FIRST (more reliable in Capacitor)
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession()

      if (sessionError) {
        console.error(sessionError)
        setHasSession(false)
        setError('Failed to check session.')
        setLoading(false)
        return
      }

      const user = session?.user

      if (!user) {
        setHasSession(false)
        setLoading(false)
        return
      }

      setHasSession(true)

      // 2) Load profile to determine role (admin / owner / staff)
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('id', user.id)
        .single<Profile>()

      if (profileError || !profile) {
        console.error(profileError)
        setError('Failed to load user profile.')
        setLoading(false)
        return
      }

      // 3) Admin â†’ go to admin panel
      if (profile.role === 'admin') {
        router.push('/admin')
        return
      }

      // 4) Check company association (owner or staff)
      const { data: rows, error: ruError } = await supabase
        .from('restaurant_users')
        .select('restaurants(id, name, email)')
        .eq('user_id', user.id)
        .limit(1)

      if (ruError) {
        console.error(ruError)
        setError('Failed to load company data.')
        setLoading(false)
        return
      }

      const typedRows = (rows ?? []) as RestaurantUserRow[]
      const join = typedRows[0]?.restaurants

      // âœ… normalize: can be object or array
      const firstRestaurant = Array.isArray(join) ? join[0] : join

      if (firstRestaurant) {
        // âœ… Main RoofLead panel
        router.push('/leads')
        return
      }

      // Authenticated user but no company associated yet
      setLoading(false)
    }

    load()
  }, [router])

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-lg">Preparing your dashboard...</p>
      </main>
    )
  }

  if (!hasSession) {
    // No session â†’ ask user to login
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold">Welcome ðŸ‘‹</h1>
        <p>To continue, please log in.</p>
        <button
            onClick={() => {
              console.log('LOGIN_BUTTON_CLICKED_BHEARD')
              window.location.href = '/login.html'
            }}
  		className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700"
        >
          Go to login
        </button>
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-red-600">{error}</p>
      </main>
    )
  }

  // Authenticated owner/staff but no company associated yet
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-3">
      <h1 className="text-3xl font-bold">Welcome ðŸ‘‹</h1>
      <p className="text-center max-w-md">
        You donâ€™t have a company set up yet.
      </p>

      <div className="flex gap-2">
        <button
          onClick={() => router.push('/restaurante/configurar')}
          className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700"
        >
          Create my company
        </button>

        <button
          onClick={() => router.push('/leads')}
          className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800"
        >
          Open Leads
        </button>
      </div>

      <p className="text-xs text-gray-500 max-w-md text-center">
        (If you donâ€™t have a company associated yet, â€œLeadsâ€ may be empty until you complete setup.)
      </p>
    </main>
  )
}

