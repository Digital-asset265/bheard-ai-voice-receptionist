'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

type InviteRole = 'owner' | 'staff'

type Invite = {
  id: string
  email: string
  status: 'pending' | 'accepted' | 'expired'
  role: InviteRole | null
  restaurant_id: string | null
}

function guessCompanyNameFromEmail(email: string) {
  const local = (email || '').split('@')[0] || 'Company'
  const cleaned = local.replace(/[^a-zA-Z0-9\s_-]/g, ' ').replace(/[_-]+/g, ' ').trim()
  const name = cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : 'Company'
  return name.slice(0, 60)
}

export default function RegistroClient() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token')

  const [invite, setInvite] = useState<Invite | null>(null)
  const [loading, setLoading] = useState(true)

  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const inviteRole: InviteRole | null = useMemo(() => {
    const r = invite?.role || null
    if (r === 'owner' || r === 'staff') return r
    return null
  }, [invite?.role])

  useEffect(() => {
    const loadInvite = async () => {
      setLoading(true)
      setError(null)

      if (!token) {
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('invites')
        .select('id, email, status, role, restaurant_id')
        .eq('token', token)
        .maybeSingle()

      if (error) {
        console.error(error)
        setError('Erro ao carregar convite.')
        setLoading(false)
        return
      }

      if (!data || data.status !== 'pending') {
        setInvite(null)
        setLoading(false)
        return
      }

      // ✅ regra: staff tem de ter restaurant_id
      if ((data.role as InviteRole | null) === 'staff' && !data.restaurant_id) {
        setError('Convite inválido: empresa não associada.')
        setInvite(null)
        setLoading(false)
        return
      }

      setInvite(data as Invite)
      setLoading(false)
    }

    loadInvite()
  }, [token])

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!invite || !token) {
      setError('Convite inválido ou expirado.')
      return
    }

    if (password.length < 6) {
      setError('A palavra-passe deve ter pelo menos 6 caracteres.')
      return
    }

    if (password !== confirmPassword) {
      setError('As palavras-passe não coincidem.')
      return
    }

    const role: InviteRole = (invite.role as InviteRole) || 'owner'
    const email = invite.email.trim().toLowerCase()

    setSubmitting(true)

    try {
      // 1) criar conta
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      })

      if (signUpError) {
        console.error('Erro no signup:', signUpError)
        setError(`Erro ao criar conta: ${signUpError.message}`)
        setSubmitting(false)
        return
      }

      const user = signUpData.user
      if (!user) {
        setError('Erro ao criar conta: utilizador não foi devolvido.')
        setSubmitting(false)
        return
      }

      // 2) profile (full_name + role)
      const nameTrimmed = fullName.trim().slice(0, 120) || null

      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle()

      if (!existingProfile) {
        const { error: profileError } = await supabase.from('profiles').insert({
          id: user.id,
          full_name: nameTrimmed,
          role,
        })

        if (profileError) {
          console.error('Erro ao criar profile:', profileError)
          setError('Conta criada, mas houve erro ao criar o perfil.')
          setSubmitting(false)
          return
        }
      } else {
        // se já existir, atualiza nome (não mexe no role)
        if (nameTrimmed) {
          const { error: updErr } = await supabase
            .from('profiles')
            .update({ full_name: nameTrimmed })
            .eq('id', user.id)
          if (updErr) console.warn('Falha a atualizar full_name (ignorar):', updErr.message)
        }
      }

      // 3) criar/associar empresa
      let restaurantId = invite.restaurant_id

      if (role === 'owner') {
        // cria empresa placeholder (company info preenche depois)
        const companyName = guessCompanyNameFromEmail(email)

        const { data: newRestaurant, error: restErr } = await supabase
          .from('restaurants')
          .insert({ name: companyName })
          .select('id')
          .single()

        if (restErr) {
          console.error('Erro a criar empresa (restaurants):', restErr)
          setError('Erro ao criar empresa. (Verifica permissões/RLS)')
          setSubmitting(false)
          return
        }

        restaurantId = newRestaurant.id

        // liga owner
        const { error: ruErr } = await supabase.from('restaurant_users').insert({
          user_id: user.id,
          restaurant_id: restaurantId,
          role: 'owner',
        })

        if (ruErr) {
          console.error('Erro a associar owner (restaurant_users):', ruErr)
          setError('Empresa criada, mas não consegui associar o utilizador à empresa. (Verifica RLS)')
          setSubmitting(false)
          return
        }
      } else {
        // staff
        if (!restaurantId) {
          setError('Convite inválido: empresa não associada.')
          setSubmitting(false)
          return
        }

        const { error: ruErr } = await supabase.from('restaurant_users').insert({
          user_id: user.id,
          restaurant_id: restaurantId,
          role: 'staff',
        })

        if (ruErr) {
          console.error('Erro a associar staff (restaurant_users):', ruErr)
          setError('Conta criada, mas falhou a associação à empresa. (Verifica RLS)')
          setSubmitting(false)
          return
        }
      }

      // 4) marcar convite como aceite (+ guardar restaurant_id)
      const { error: inviteError } = await supabase
        .from('invites')
        .update({
          status: 'accepted',
          restaurant_id: restaurantId ?? invite.restaurant_id ?? null,
        })
        .eq('id', invite.id)

      if (inviteError) {
        console.warn('Erro ao atualizar invite (não bloqueia):', inviteError.message)
      }

      // 5) redirect: direto para dashboard
      router.push('/leads')
    } catch (err: any) {
      console.error(err)
      setError('Erro inesperado ao criar conta.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-lg">A carregar convite...</p>
      </main>
    )
  }

  if (!token || !invite) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold text-red-600">Convite inválido ❌</h1>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <a href="/login" className="text-blue-600 underline">
          Voltar ao login
        </a>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md border rounded-xl p-6 shadow-sm">
        <h1 className="text-2xl font-bold mb-2 text-center">Criar conta 🔐</h1>

        <p className="mb-1 text-center text-sm text-gray-700">
          Convite para: <strong>{invite.email}</strong>
        </p>

        <p className="mb-4 text-center text-xs text-gray-500">
          Permissão: <span className="font-semibold">{inviteRole ?? 'owner'}</span>
        </p>

        <form onSubmit={handleRegister} className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="full_name">
              O teu nome
            </label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              className="w-full border rounded-lg px-3 py-2 outline-none"
              placeholder="Ex: André Peixoto"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
            />
            <p className="text-[11px] text-gray-500">
              (Vai aparecer no topo da app quando entrares.)
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="password">
              Palavra-passe
            </label>
            <div className="flex border rounded-lg overflow-hidden">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                className="flex-1 px-3 py-2 outline-none"
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="px-3 text-sm text-gray-600 border-l hover:bg-gray-50"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? 'Ocultar' : 'Ver'}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="confirm_password">
              Confirmar palavra-passe
            </label>
            <input
              id="confirm_password"
              name="confirm_password"
              type={showPassword ? 'text' : 'password'}
              className="w-full border rounded-lg px-3 py-2 outline-none"
              placeholder="Repete a palavra-passe"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>

          {error && <p className="text-sm text-red-600 text-center">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-2 rounded-lg"
          >
            {submitting ? 'A criar...' : 'Criar conta'}
          </button>
        </form>

        <p className="mt-4 text-xs text-center text-gray-500">
          Para entrar novamente no futuro, use este email e a palavra-passe que acabou de definir.
        </p>
      </div>
    </main>
  )
}