'use client'

import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { v4 as uuidv4 } from 'uuid'

export default function InvitePage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setInviteLink(null)
    setLoading(true)

    // garantir que o admin está autenticado (só para segurança extra)
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()

    if (authErr) {
      setError('Erro ao validar sessão: ' + authErr.message)
      setLoading(false)
      return
    }

    if (!user) {
      setError('Precisa de iniciar sessão novamente.')
      setLoading(false)
      return
    }

    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      setError('Email inválido.')
      setLoading(false)
      return
    }

    // ✅ Evitar spam: se já existir um convite pending para este email, reutiliza-o
    const { data: existing, error: existingErr } = await supabase
      .from('invites')
      .select('token, status, role')
      .eq('email', normalizedEmail)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingErr) {
      console.warn('Aviso ao procurar convite existente:', existingErr.message)
      // não bloqueia — segue e cria novo
    }

    if (existing?.token) {
      const link = `${window.location.origin}/registro?token=${existing.token}`
      setInviteLink(link)
      setLoading(false)
      return
    }

    const token = uuidv4()

    // ✅ convite do ADMIN -> tem de ser sempre owner
    const insertPayload: any = {
      email: normalizedEmail,
      token,
      role: 'owner',
      // status fica 'pending' pelo default da tabela
      // restaurant_id: (deixa null) -> o owner vai criar/associar depois
      // expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(), // (só se existir coluna)
    }

    const { error: insertErr } = await supabase.from('invites').insert(insertPayload)

    if (insertErr) {
      console.error(insertErr)
      setError('Erro ao registar convite: ' + insertErr.message)
      setLoading(false)
      return
    }

    const link = `${window.location.origin}/registro?token=${token}`
    setInviteLink(link)
    setLoading(false)
  }

  return (
    <main className="min-h-screen p-8 flex flex-col items-center">
      <h1 className="text-2xl font-bold mb-6">Convidar dono 📩</h1>

      <form onSubmit={handleInvite} className="flex flex-col gap-4 max-w-md w-full">
        <input
          type="email"
          required
          placeholder="Email do dono"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border rounded-lg p-3"
        />

        <button
          disabled={loading}
          className="p-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
        >
          {loading ? 'A enviar convite...' : 'Enviar convite'}
        </button>
      </form>

      {error && <p className="mt-4 text-red-600">{error}</p>}

      {inviteLink && (
        <div className="mt-6 border rounded-lg p-4 bg-green-100">
          <p>Convite criado! Envia este link:</p>
          <p className="font-mono break-all mt-2">{inviteLink}</p>
        </div>
      )}
    </main>
  )
}