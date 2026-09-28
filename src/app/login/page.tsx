'use client'

import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useRouter } from 'next/navigation'
import { initPushNotifications } from '../../lib/pushNotifications'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    console.log('LOGIN_SUCCESS_BHEARD')

    router.replace('/')

    void initPushNotifications().catch((e) => {
      console.warn('Push init after login failed:', e)
    })
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md border rounded-xl p-6 shadow-sm">
        <h1 className="text-2xl font-bold mb-4 text-center">Entrar DEBUG LOGIN v2</h1>

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <input
            type="email"
            required
            placeholder="O seu email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border rounded-lg p-3"
          />

          <input
            type="password"
            required
            placeholder="A sua palavra-passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border rounded-lg p-3"
          />

          <button
            type="submit"
            disabled={loading}
            className="p-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? 'A entrar...' : 'Entrar'}
          </button>
        </form>

        {error && <p className="mt-4 text-red-600 text-sm">{error}</p>}

        <p className="mt-6 text-xs text-gray-500 text-center">
          Para criar conta precisa de um convite enviado pelo administrador.
        </p>
      </div>
    </main>
  )
}

