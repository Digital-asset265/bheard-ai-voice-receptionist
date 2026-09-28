'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type RU = {
  restaurant_id: string
  role: 'owner' | 'staff' | 'staff_admin'
}

function addDaysIso(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

export default function InviteNewMemberPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [ru, setRu] = useState<RU | null>(null)
  const [email, setEmail] = useState('')
  const [fullAccess, setFullAccess] = useState(false)

  const [creating, setCreating] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  const roleToInvite = useMemo<'staff' | 'staff_admin'>(() => (fullAccess ? 'staff_admin' : 'staff'), [fullAccess])

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const { data: auth } = await supabase.auth.getUser()
      const user = auth?.user
      if (!user) {
        router.push('/login')
        return
      }

      const { data, error } = await supabase
        .from('restaurant_users')
        .select('restaurant_id, role')
        .eq('user_id', user.id)
        .maybeSingle()

      if (error || !data?.restaurant_id) {
        router.push('/leads')
        return
      }

      const current = data as RU

      // Só owner / staff_admin
      if (current.role !== 'owner' && current.role !== 'staff_admin') {
        router.push('/leads')
        return
      }

      setRu(current)
      setLoading(false)
    })()
  }, [router])

  async function createInvite() {
    setMsg(null)
    setInviteLink(null)

    if (!ru?.restaurant_id) return
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setMsg('Email inválido.')
      return
    }

    setCreating(true)
    try {
      const token = crypto.randomUUID()

      const payload = {
        restaurant_id: ru.restaurant_id,
        email: cleanEmail,
        token,
        status: 'pending',
        role: roleToInvite,
        expires_at: addDaysIso(7),
      }

      const { error } = await supabase.from('invites').insert(payload as any)
      if (error) throw error

      // Link para signup (reaproveita a tua página de registro)
      const link = `${window.location.origin}/registro?token=${encodeURIComponent(token)}`
      setInviteLink(link)
      setMsg('Convite criado ✅ (copia o link abaixo)')
      setEmail('')
      setFullAccess(false)
    } catch (e: any) {
      console.error(e)
      setMsg(`Falha ao criar convite: ${e?.message || e}`)
    } finally {
      setCreating(false)
      setTimeout(() => setMsg(null), 3000)
    }
  }

  if (loading) return <main className="min-h-screen p-6">A carregar...</main>

  return (
    <main className="min-h-screen p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Invite new member</h1>
          <p className="text-sm text-gray-600">Invite staff to your company.</p>
        </div>

        <button
          onClick={() => router.push('/leads')}
          className="px-4 py-2 rounded-lg border hover:bg-gray-50"
        >
          Back
        </button>
      </div>

      <div className="p-4 rounded-xl border shadow-sm space-y-4 max-w-xl">
        <label className="space-y-1 block">
          <div className="text-sm font-semibold">Member email</div>
          <input
            className="w-full border rounded-lg p-2"
            placeholder="example@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fullAccess}
            onChange={(e) => setFullAccess(e.target.checked)}
          />
          Permitir acesso total (staff_admin)
        </label>

        <button
          onClick={createInvite}
          disabled={creating}
          className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create invite'}
        </button>

        {msg && (
          <p className={msg.includes('Falha') ? 'text-red-600 text-sm' : 'text-green-700 text-sm'}>
            {msg}
          </p>
        )}

        {inviteLink && (
          <div className="p-3 rounded-lg border bg-gray-50 space-y-2">
            <div className="text-sm font-semibold">Invite link</div>
            <div className="text-xs break-all font-mono">{inviteLink}</div>
            <button
              className="px-3 py-2 rounded-lg border hover:bg-white text-sm"
              onClick={async () => {
                await navigator.clipboard.writeText(inviteLink)
                setMsg('Link copiado ✅')
                setTimeout(() => setMsg(null), 2000)
              }}
            >
              Copy link
            </button>
          </div>
        )}
      </div>
    </main>
  )
}