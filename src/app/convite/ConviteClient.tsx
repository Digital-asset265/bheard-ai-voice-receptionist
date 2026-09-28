'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

type Invite = {
  id: string
  email: string
  status: 'pending' | 'accepted' | 'expired' | null
  restaurant_id: string
  role: string | null
  expires_at: string | null
}

export default function ConviteClient() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token')

  const [invite, setInvite] = useState<Invite | null>(null)
  const [loading, setLoading] = useState(true)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    const loadInvite = async () => {
      setError(null)

      if (!token) {
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('invites')
        .select('id, email, status, restaurant_id, role, expires_at')
        .eq('token', token)
        .maybeSingle()

      if (error) {
        console.error(error)
        setError('Erro ao carregar convite.')
        setLoading(false)
        return
      }

      if (!data) {
        setInvite(null)
        setLoading(false)
        return
      }

      // validar estado e expiração
      const now = new Date()
      const expired = data.expires_at && new Date(data.expires_at) < now

      if (data.status !== 'pending' || expired) {
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

    if (!invite) {
      setError('Convite inválido ou expirado.')
      return
    }

    try {
      const email = invite.email.trim().toLowerCase()

      // 1) tentar criar conta
      const { data: signUpData, error: signUpError } =
        await supabase.auth.signUp({
          email,
          password,
        })

      let user = signUpData.user

      // se já existir conta, tentamos login
      if (
        signUpError &&
        signUpError.message.toLowerCase().includes('already registered')
      ) {
        const { data: signInData, error: signInError } =
          await supabase.auth.signInWithPassword({
            email,
            password,
          })

        if (signInError || !signInData.user) {
          console.error('Erro ao entrar como utilizador existente:', signInError)
          setError(
            'Já existe uma conta com este email. Introduz a palavra-passe correta.'
          )
          return
        }

        user = signInData.user
      } else if (signUpError) {
        console.error('Erro no signup:', signUpError)
        setError(`Erro ao criar/entrar na conta: ${signUpError.message}`)
        return
      }

      if (!user) {
        setError('Erro ao criar/entrar na conta: utilizador não foi devolvido.')
        return
      }

      // 2) garantir que existe profile (se ainda não existir)
      const { data: existingProfile, error: profileSelectError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle()

      if (profileSelectError) {
        console.error('Erro ao verificar profile:', profileSelectError)
      }

      if (!existingProfile) {
        const { error: profileInsertError } = await supabase.from('profiles').insert({
          id: user.id,
          full_name: null,
          role: 'staff',
        })

        if (profileInsertError) {
          console.error('Erro ao criar profile:', profileInsertError)
          setError(
            'Conta criada, mas houve erro ao criar o perfil. Fala com o responsável.'
          )
          // continuamos o fluxo
        }
      }

      // 3) ligar este utilizador ao restaurante como staff
      const { error: linkError } = await supabase.from('restaurant_users').insert({
        restaurant_id: invite.restaurant_id,
        user_id: user.id,
        role: invite.role || 'staff',
      })

      if (linkError) {
        console.error('Erro ao associar utilizador ao restaurante:', linkError)
        setError(
          'Conta criada, mas houve erro ao associar ao restaurante. Fala com o dono para resolver.'
        )
      }

      // 4) tentar marcar convite como aceite
      const { error: inviteError } = await supabase
        .from('invites')
        .update({ status: 'accepted' })
        .eq('id', invite.id)

      if (inviteError) {
        console.warn('Não foi possível atualizar o estado do convite:', inviteError)
      }

      // 5) redirecionar staff para o painel do restaurante
      router.push('/restaurante')
    } catch (err: any) {
      console.error(err)
      setError('Erro inesperado ao criar/ligar a conta.')
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
        <a href="/login" className="text-blue-600 underline">
          Voltar ao login
        </a>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md border rounded-xl p-6 shadow-sm space-y-4">
        <h1 className="text-2xl font-bold text-center">Convite para staff 👋</h1>

        <p className="text-sm text-gray-700 text-center">
          Vais criar acesso de <strong>staff</strong> para o restaurante.
        </p>

        <p className="text-sm text-gray-700 text-center">
          Email do convite: <strong>{invite.email}</strong>
        </p>

        <form onSubmit={handleRegister} className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Palavra-passe</label>
            <div className="flex border rounded-lg overflow-hidden">
              <input
                type={showPassword ? 'text' : 'password'}
                className="flex-1 px-3 py-2 outline-none"
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
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

          {error && <p className="text-sm text-red-600 text-center">{error}</p>}

          <button
            type="submit"
            className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded-lg"
          >
            Criar conta / Entrar
          </button>
        </form>

        <p className="mt-2 text-xs text-center text-gray-500">
          Para entrar novamente no futuro, usa este email e a palavra-passe que
          acabaste de definir.
        </p>
      </div>
    </main>
  )
}
