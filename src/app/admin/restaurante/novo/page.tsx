'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabaseClient'

export default function NovoRestaurantePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('O nome do restaurante é obrigatório.')
      return
    }

    setLoading(true)

    try {
      // 1. Obter utilizador atual
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        setError('Utilizador não autenticado.')
        setLoading(false)
        return
      }

      // 2. Criar restaurante
      const { data: restaurant, error: createError } = await supabase
        .from('restaurants')
        .insert({
          name,
          email: email || null,
        })
        .select('id')
        .single()

      if (createError || !restaurant) {
        console.error(createError)
        setError('Erro ao criar restaurante.')
        setLoading(false)
        return
      }

      // 3. Ligar o utilizador ao restaurante como owner
      const { error: linkError } = await supabase.from('restaurant_users').insert({
        restaurant_id: restaurant.id,
        user_id: user.id,
        role: 'owner',
      })

      if (linkError) {
        console.error(linkError)
        setError('Restaurante criado mas falhou a ligação ao utilizador.')
        setLoading(false)
        return
      }

      // 4. Redirecionar de volta ao painel admin ou home
      router.push('/admin')
    } catch (err) {
      console.error(err)
      setError('Ocorreu um erro inesperado.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md border rounded-lg p-6 shadow-md">
        <h1 className="text-2xl font-bold mb-4 text-center">
          Criar novo restaurante
        </h1>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium mb-1">
              Nome do restaurante *
            </label>
            <input
              type="text"
              className="w-full border rounded-md px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Restaurante Solar do Tejo"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Email de contacto (opcional)
            </label>
            <input
              type="email"
              className="w-full border rounded-md px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="restaurante@exemplo.com"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 text-white py-2 rounded-md hover:bg-green-700 disabled:opacity-60"
          >
            {loading ? 'A criar...' : 'Criar restaurante'}
          </button>
        </form>

        <button
          type="button"
          className="mt-4 w-full text-center text-sm text-gray-600 hover:underline"
          onClick={() => router.push('/admin')}
        >
          ← Voltar ao painel do admin
        </button>
      </div>
    </main>
  )
}
