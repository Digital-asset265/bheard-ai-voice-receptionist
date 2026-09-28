'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabaseClient'

const ADMIN_EMAIL = 'andrepeixoto265@gmail.com'

type SubscriptionRow = {
  status: string | null
  next_renewal: string | null
  notes?: string | null
}

type RestaurantRow = {
  id: string
  name: string
  email: string | null
  created_at: string
  subscriptions: SubscriptionRow[] | null // ✅ vem como ARRAY no select
}

type Row = {
  id: string
  name: string
  email: string
  status: string
  next_renewal: string // YYYY-MM-DD
}

function toDateInput(value: string | null): string {
  if (!value) return ''
  return new Date(value).toISOString().slice(0, 10)
}

export default function RenovacoesHojePage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.replace('/login')
        return
      }

      if (user.email !== ADMIN_EMAIL) {
        router.replace('/')
        return
      }

      const todayStr = new Date().toISOString().slice(0, 10)

      const { data, error: fetchError } = await supabase
        .from('restaurants')
        .select('id, name, email, created_at, subscriptions(status, next_renewal)')
        .order('created_at', { ascending: true })

      if (fetchError) {
        console.error(fetchError)
        setError('Erro ao carregar renovações de hoje.')
        setLoading(false)
        return
      }

      const safe = (data ?? []) as RestaurantRow[]

      const mapped: Row[] = safe.flatMap((r) => {
        const sub = Array.isArray(r.subscriptions) ? r.subscriptions[0] : null
        const next = toDateInput(sub?.next_renewal || null)
        const status = ((sub?.status || 'trial') as string).toLowerCase()

        if (!next) return []
        if (status === 'cancelled') return []
        if (next !== todayStr) return [] // ✅ só hoje

        return [
          {
            id: r.id,
            name: r.name,
            email: r.email ?? '',
            status,
            next_renewal: next,
          },
        ]
      })

      setRows(mapped)
      setLoading(false)
    }

    load()
  }, [router])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return rows
    return rows.filter((r) => {
      return (
        r.name.toLowerCase().includes(term) ||
        r.email.toLowerCase().includes(term) ||
        r.id.toLowerCase().includes(term)
      )
    })
  }, [rows, search])

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-lg">A carregar…</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-8 bg-gray-50">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Renovam hoje</h1>
          <p className="text-sm text-gray-600">
            Lista de restaurantes cuja data de renovação é hoje.
          </p>
        </div>

        <button
          type="button"
          onClick={() => router.push('/admin')}
          className="text-sm text-purple-600 hover:underline"
        >
          Voltar ao admin
        </button>
      </header>

      <section className="bg-white border rounded-xl shadow-sm p-4 mb-4">
        <input
          type="text"
          placeholder="Pesquisar por nome, email ou ID…"
          className="w-full border rounded-lg px-3 py-2 text-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </section>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <section className="bg-white border rounded-xl shadow-sm p-4">
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-500">
            Não há renovações a ocorrer hoje.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100 text-left">
                <tr>
                  <th className="px-3 py-2">Restaurante</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Renovação</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-[11px] text-gray-500">
                        ID: {r.id.slice(0, 8)}…
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">{r.email}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex px-2 py-1 rounded-full text-xs bg-purple-50 text-purple-700 border border-purple-200">
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">{r.next_renewal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
