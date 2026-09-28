'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type Invite = {
  id: string
  email: string
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  restaurant_id: string | null
  role: 'owner' | 'staff' | 'staff_admin'
  expires_at: string | null
  token: string
}

function isExpired(expiresAt: string | null) {
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() < Date.now()
}

function AcceptInviteInner() {
  const router = useRouter()
  const sp = useSearchParams()
  const token = sp.get('token')

  const [loading, setLoading] = useState(true)
  const [invite, setInvite] = useState<Invite | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setError(null)

      if (!token) {
        setLoading(false)
        setError('Token em falta.')
        return
      }

      const { data, error } = await supabase
        .from('invites')
        .select('id, email, status, restaurant_id, role, expires_at, token')
        .eq('token', token)
        .maybeSingle()

      if (error) {
        console.error(error)
        setError('Erro ao carregar convite.')
        setLoading(false)
        return
      }

      if (!data) {
        setError('Convite não encontrado.')
        setLoading(false)
        return
      }

      const inv = data as Invite
      if (inv.status !== 'pending' || isExpired(inv.expires_at)) {
        setError('Convite inválido ou expirado.')
        setLoading(false)
        return
      }

      setInvite(inv)
      setLoading(false)
    })()
  }, [token])

  async function accept() {
    setError(null)
    if (!invite) return

    if (!invite.restaurant_id) {
      setError('Convite inválido: empresa não associada.')
      return
    }

    setAccepting(true)
    try {
      const { data: auth } = await supabase.auth.getUser()
      const user = auth?.user

      if (!user) {
        // não logado -> usar o teu fluxo de registo
        router.push(`/registro?token=${encodeURIComponent(invite.token)}`)
        return
      }

      // (opcional) se quiseres garantir que o email do user bate com o do convite:
      const userEmail = (user.email || '').toLowerCase().trim()
      const inviteEmail = invite.email.toLowerCase().trim()
      if (userEmail && userEmail !== inviteEmail) {
        setError('Este convite é para outro email. Faz login com o email correto.')
        setAccepting(false)
        return
      }

      // 1) ligar ao restaurant_users
      const { error: ruError } = await supabase.from('restaurant_users').upsert(
        {
          user_id: user.id,
          restaurant_id: invite.restaurant_id,
          role: invite.role,
        },
        { onConflict: 'user_id,restaurant_id' as any }
      )
      if (ruError) throw ruError

      // 2) atualizar profile (se existir)
      await supabase.from('profiles').upsert({ id: user.id, role: invite.role } as any)

      // 3) marcar invite accepted
      await supabase.from('invites').update({ status: 'accepted' }).eq('id', invite.id)

      // redirect
      if (invite.role === 'owner') router.push('/empresa/configurar')
      else router.push('/leads')
    } catch (e: any) {
      console.error(e)
      setError(e?.message || 'Erro ao aceitar convite.')
    } finally {
      setAccepting(false)
    }
  }

  if (loading) return <main className="min-h-screen p-6">A carregar convite...</main>

  if (error) {
    return (
      <main className="min-h-screen p-6">
        <p className="text-red-600">Erro: {error}</p>
        <button
          className="mt-4 px-4 py-2 rounded-lg border hover:bg-gray-50"
          onClick={() => router.push('/login')}
        >
          Ir para login
        </button>
      </main>
    )
  }

  if (!invite) {
    return (
      <main className="min-h-screen p-6">
        <p>Convite inválido.</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-6 flex items-center justify-center">
      <div className="w-full max-w-md border rounded-xl p-6 shadow-sm space-y-4">
        <h1 className="text-2xl font-bold">Aceitar convite</h1>
        <p className="text-sm text-gray-700">
          Convite para: <b>{invite.email}</b>
        </p>
        <p className="text-xs text-gray-500">
          Permissão: <span className="font-mono">{invite.role}</span>
        </p>

        <button
          disabled={accepting}
          onClick={accept}
          className="w-full px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
        >
          {accepting ? 'A aceitar...' : 'Accept invite'}
        </button>

        <button
          onClick={() => router.push('/login')}
          className="w-full px-4 py-2 rounded-lg border hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </main>
  )
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<main className="min-h-screen p-6">A carregar…</main>}>
      <AcceptInviteInner />
    </Suspense>
  )
}