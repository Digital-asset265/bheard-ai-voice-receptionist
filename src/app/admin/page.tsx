'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'

const ADMIN_EMAIL = 'andrepeixoto265@gmail.com'

// --- Tipos ---

type Profile = {
  id: string
  full_name: string | null
  role: string | null
}

type SubscriptionRow = {
  status: string | null
  next_renewal: string | null
  notes: string | null
}

type RestaurantRow = {
  id: string
  name: string
  email: string | null
  created_at: string
  // ✅ IMPORTANTE: o select subscriptions(...) devolve um ARRAY
  subscriptions: SubscriptionRow[] | null
}

type AdminRestaurant = {
  id: string
  name: string
  email: string
  created_at: string // YYYY-MM-DD
  status: string // 'trial' | 'active' | 'overdue' | 'cancelled'
  next_renewal: string // YYYY-MM-DD
  notes: string
}

// ✅ Invites (para pesquisa inteligente de owners com empresa associada)
type OwnerInviteRow = {
  id: string
  email: string
  restaurant_id: string
  role: 'owner' | 'staff' | 'staff_admin' | string
  status: 'pending' | 'accepted' | 'expired' | 'revoked' | string
}

// --- Helpers ---

function toDateInput(value: string | null): string {
  if (!value) return ''
  return new Date(value).toISOString().slice(0, 10)
}

function addOneMonth(base?: string): string {
  const d = base ? new Date(base) : new Date()
  d.setMonth(d.getMonth() + 1)
  return d.toISOString().slice(0, 10)
}

function cleanPhoneE164(input: string) {
  const raw = (input || '').trim()
  if (!raw) return ''
  // deixa + e dígitos
  const cleaned = raw.replace(/[^\d+]/g, '')
  return cleaned
}

function looksLikeE164(phone: string) {
  // bem simples (aceita + e 8-15 dígitos)
  if (!phone) return false
  if (!phone.startsWith('+')) return false
  const digits = phone.slice(1).replace(/\D/g, '')
  return digits.length >= 8 && digits.length <= 15
}

// --- Componente principal ---

export default function AdminPage() {
  const router = useRouter()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [restaurants, setRestaurants] = useState<AdminRestaurant[]>([])
  const [savingId, setSavingId] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] =
    useState<'all' | 'trial' | 'active' | 'overdue' | 'cancelled'>('all')

  // ✅ NOVO: secção associar número a owner
  const [ownerSearch, setOwnerSearch] = useState('')
  const [ownerResults, setOwnerResults] = useState<OwnerInviteRow[]>([])
  const [ownerLoading, setOwnerLoading] = useState(false)
  const [ownerSelected, setOwnerSelected] = useState<OwnerInviteRow | null>(null)

  const [phoneNumber, setPhoneNumber] = useState('')
  const [provider, setProvider] = useState<'twilio' | 'io'>('twilio')
  const [friendlyName, setFriendlyName] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [assignMsg, setAssignMsg] = useState<string | null>(null)

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setLoadError(null)

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

      const { data: prof, error: profError } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('id', user.id)
        .single()

      if (profError || !prof) {
        console.error(profError)
        router.replace('/')
        return
      }

      setProfile(prof)

      const { data: rows, error: restError } = await supabase
        .from('restaurants')
        .select('id, name, email, created_at, subscriptions(status, next_renewal, notes)')
        .order('created_at', { ascending: true })

      if (restError) {
        console.error(restError)
        setLoadError('Erro ao carregar subscrições.')
        setLoading(false)
        return
      }

      const safeRows = (rows ?? []) as RestaurantRow[]

      const mapped: AdminRestaurant[] = safeRows.map((r) => {
        // ✅ como subscriptions é array, pegamos o 1º registo (se existir)
        const sub = Array.isArray(r.subscriptions) ? r.subscriptions[0] : null

        const status = ((sub?.status || 'trial') as string).toLowerCase()

        const next = toDateInput(sub?.next_renewal || addOneMonth(r.created_at)) || ''

        return {
          id: r.id,
          name: r.name,
          email: r.email ?? '',
          created_at: toDateInput(r.created_at),
          status,
          next_renewal: next,
          notes: sub?.notes || '',
        }
      })

      setRestaurants(mapped)
      setLoading(false)
    }

    load()
  }, [router])

  // ✅ NOVO: pesquisa inteligente de owners (invites aceites)
  useEffect(() => {
    let alive = true

    async function run() {
      const term = ownerSearch.trim().toLowerCase()
      setOwnerSelected(null)
      setAssignMsg(null)

      if (!term || term.length < 2) {
        setOwnerResults([])
        return
      }

      setOwnerLoading(true)
      try {
        const { data, error } = await supabase
          .from('invites')
          .select('id, email, restaurant_id, role, status')
          .eq('status', 'accepted')
          .eq('role', 'owner')
          .not('restaurant_id', 'is', null)
          .ilike('email', `%${term}%`)
          .order('email', { ascending: true })
          .limit(20)

        if (!alive) return

        if (error) {
          console.error(error)
          setOwnerResults([])
          return
        }

        setOwnerResults((data as any as OwnerInviteRow[]) ?? [])
      } finally {
        if (alive) setOwnerLoading(false)
      }
    }

    run()
    return () => {
      alive = false
    }
  }, [ownerSearch])

  const handleFieldChange = (
    id: string,
    field: keyof Pick<AdminRestaurant, 'status' | 'next_renewal' | 'notes'>,
    value: string
  ) => {
    setRestaurants((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
  }

  const handleMarkMonthPaid = (id: string) => {
    setRestaurants((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              next_renewal: addOneMonth(r.next_renewal || undefined),
            }
          : r
      )
    )
  }

  const handleSave = async (r: AdminRestaurant) => {
    setSavingId(r.id)
    try {
      const { error } = await supabase.from('subscriptions').upsert(
        {
          restaurant_id: r.id,
          status: r.status,
          next_renewal: r.next_renewal || null,
          notes: r.notes || null,
        },
        { onConflict: 'restaurant_id' }
      )

      if (error) {
        console.error(error)
        alert('Erro ao guardar subscrição. Ver consola.')
      } else {
        alert('Estado guardado com sucesso.')
      }
    } catch (err) {
      console.error(err)
      alert('Erro inesperado ao guardar.')
    } finally {
      setSavingId(null)
    }
  }

  // ✅ NOVO: associar número ao owner selecionado (AGORA via API server-side)
  const handleAssignPhone = async () => {
    setAssignMsg(null)

    if (!ownerSelected) {
      setAssignMsg('Seleciona um email (owner) a partir da lista.')
      return
    }

    if (!ownerSelected.restaurant_id) {
      setAssignMsg('Owner selecionado sem restaurant_id (inválido).')
      return
    }

    if ((ownerSelected.role || '').toLowerCase() !== 'owner') {
      setAssignMsg('Este email não é owner. O sistema rejeitou.')
      return
    }

    const clean = cleanPhoneE164(phoneNumber)
    if (!looksLikeE164(clean)) {
      setAssignMsg('Número inválido. Usa formato E.164, ex: +13254137600')
      return
    }

    setAssigning(true)
    try {
      // ✅ CHAMA API /api/admin/phone-numbers (service_role bypass RLS)
      const res = await fetch('/api/admin/phone-numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminEmail: ADMIN_EMAIL,
          ownerEmail: ownerSelected.email,
          restaurantId: ownerSelected.restaurant_id,
          phoneNumber: clean,
          provider,
          friendlyName: friendlyName.trim() || null,
        }),
      })

      const json = await res.json()
      if (!res.ok) {
        setAssignMsg(`Erro ao associar número: ${json?.error || 'Erro desconhecido'}`)
        return
      }

      setAssignMsg('✅ Número associado com sucesso e registado em phone_numbers.')
      setOwnerSearch('')
      setOwnerResults([])
      setOwnerSelected(null)
      setPhoneNumber('')
      setProvider('twilio')
      setFriendlyName('')
    } catch (e: any) {
      console.error(e)
      setAssignMsg(`Erro inesperado: ${e?.message || e}`)
    } finally {
      setAssigning(false)
      setTimeout(() => setAssignMsg(null), 4000)
    }
  }

  // --- Derivados: contadores para os cards ---

  const { renewToday, renewTomorrow, overdueCount } = useMemo(() => {
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().slice(0, 10)

    let todayCount = 0
    let tomorrowCount = 0
    let overdue = 0

    for (const r of restaurants) {
      if (!r.next_renewal) continue
      if (r.status === 'cancelled') continue

      if (r.next_renewal === todayStr) {
        todayCount++
      } else if (r.next_renewal === tomorrowStr) {
        tomorrowCount++
      } else if (r.next_renewal < todayStr) {
        overdue++
      }
    }

    return {
      renewToday: todayCount,
      renewTomorrow: tomorrowCount,
      overdueCount: overdue,
    }
  }, [restaurants])

  // --- Filtro por pesquisa + estado ---
  // NOVO: se não houver texto na pesquisa, não mostra nada.
  const filtered = restaurants.filter((r) => {
    const term = search.trim().toLowerCase()
    if (!term) return false

    const matchesSearch =
      r.name.toLowerCase().includes(term) ||
      r.email.toLowerCase().includes(term) ||
      r.id.toLowerCase().includes(term)

    const matchesStatus = statusFilter === 'all' || r.status.toLowerCase() === statusFilter

    return matchesSearch && matchesStatus
  })

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-lg">🔒 A verificar permissões de admin…</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-8 bg-gray-50">
      {/* Top bar */}
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Painel admin 📊</h1>
          <p className="text-sm text-gray-600">
            Controlo das contas dos restaurantes, estado de pagamento e renovações.
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Admin: <strong>{profile?.full_name || ADMIN_EMAIL}</strong>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="/admin/convidar"
            className="text-sm px-3 py-2 rounded-lg border border-purple-500 text-purple-600 hover:bg-purple-50"
          >
            📩 Gerir convites para novos donos
          </a>

          <button
            onClick={handleLogout}
            className="bg-red-500 hover:bg-red-600 text-white text-sm px-3 py-2 rounded-lg"
          >
            Terminar sessão
          </button>
        </div>
      </header>

      {/* ✅ NOVO: Associar número a owner (phone_numbers) */}
      <section className="bg-white border rounded-xl shadow-sm p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">
          Associar número a um dono (phone_numbers)
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Pesquisa inteligente por email (apenas <b>owners</b> com invite aceite e empresa associada).
          Depois associa o número e cria a linha completa na tabela <b>phone_numbers</b>.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="relative">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Email do dono</label>
            <input
              type="text"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="Começa a escrever... ex: andre@"
              value={ownerSearch}
              onChange={(e) => setOwnerSearch(e.target.value)}
            />

            {/* dropdown */}
            {(ownerLoading || ownerResults.length > 0) && ownerSearch.trim().length >= 2 && (
              <div className="absolute z-20 mt-2 w-full bg-white border rounded-lg shadow-lg overflow-hidden">
                {ownerLoading ? (
                  <div className="px-3 py-2 text-sm text-gray-500">A pesquisar…</div>
                ) : ownerResults.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-500">Sem resultados.</div>
                ) : (
                  ownerResults.map((o) => (
                    <button
                      type="button"
                      key={o.id}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                      onClick={() => {
                        setOwnerSelected(o)
                        setOwnerSearch(o.email)
                        setOwnerResults([])
                      }}
                    >
                      <div className="font-medium">{o.email}</div>
                      <div className="text-[11px] text-gray-500">
                        restaurant_id: <span className="font-mono">{o.restaurant_id.slice(0, 8)}…</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}

            {ownerSelected && (
              <div className="mt-2 text-xs text-green-700">
                Selecionado: <b>{ownerSelected.email}</b> (restaurant_id{' '}
                <span className="font-mono">{ownerSelected.restaurant_id}</span>)
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Número (E.164)</label>
            <input
              type="text"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="+13254137600"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
            />
            <div className="mt-1 text-[11px] text-gray-500">
              Dica: usa sempre <b>+</b> e o country code (ex: +1…).
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Provider</label>
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={provider}
              onChange={(e) => setProvider(e.target.value as any)}
            >
              <option value="twilio">twilio</option>
              <option value="io">io</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Friendly name (opcional)</label>
            <input
              type="text"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="Main line / Sales / Support..."
              value={friendlyName}
              onChange={(e) => setFriendlyName(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleAssignPhone}
            disabled={assigning}
            className="bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-lg"
          >
            {assigning ? 'A associar…' : 'Associar número'}
          </button>

          {assignMsg && (
            <span className={assignMsg.startsWith('✅') ? 'text-sm text-green-700' : 'text-sm text-red-600'}>
              {assignMsg}
            </span>
          )}
        </div>
      </section>

      {/* Cards de resumo – AGORA CLICÁVEIS */}
      <section className="grid gap-4 grid-cols-1 md:grid-cols-3 mb-6">
        <button
          type="button"
          onClick={() => router.push('/admin/renovacoes/hoje')}
          className="bg-white border rounded-xl shadow-sm p-4 text-left hover:border-purple-500 hover:shadow-md transition cursor-pointer"
        >
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Renovam <strong>hoje</strong>
          </p>
          <p className="text-3xl font-bold mt-2">{renewToday}</p>
          <p className="text-xs text-gray-500 mt-2">Rever estas contas antes do fim do dia.</p>
        </button>

        <button
          type="button"
          onClick={() => router.push('/admin/renovacoes/amanha')}
          className="bg-white border rounded-xl shadow-sm p-4 text-left hover:border-purple-500 hover:shadow-md transition cursor-pointer"
        >
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Renovam <strong>amanhã</strong>
          </p>
          <p className="text-3xl font-bold mt-2">{renewTomorrow}</p>
          <p className="text-xs text-gray-500 mt-2">
            Bom momento para contactar e confirmar pagamento.
          </p>
        </button>

        <button
          type="button"
          onClick={() => router.push('/admin/renovacoes/atraso')}
          className="bg-white border rounded-xl shadow-sm p-4 text-left hover:border-red-400 hover:shadow-md transition cursor-pointer"
        >
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Contas <strong>em atraso</strong>
          </p>
          <p className="text-3xl font-bold mt-2 text-red-600">{overdueCount}</p>
          <p className="text-xs text-gray-500 mt-2">Considerar bloquear serviço ou entrar em contacto.</p>
        </button>
      </section>

      {/* Barra de pesquisa + filtros */}
      <section className="bg-white border rounded-xl shadow-sm p-4 mb-4">
        <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <input
            type="text"
            placeholder="Pesquisar por nome, email ou ID do restaurante…"
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <select
            className="border rounded-lg px-3 py-2 text-sm w-full md:w-52"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="all">Todos os estados</option>
            <option value="trial">Trial</option>
            <option value="active">Ativo</option>
            <option value="overdue">Em atraso</option>
            <option value="cancelled">Cancelado</option>
          </select>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          A pesquisa é inteligente: ao escrever &quot;Tas&quot; encontras, por exemplo,
          &quot;Tasquinha do Zé&quot;. Sem pesquisa, a tabela abaixo fica vazia de propósito.
        </p>
      </section>

      {loadError && <p className="text-sm text-red-600 mb-2">{loadError}</p>}

      {/* Tabela de restaurantes */}
      <section className="bg-white border rounded-xl shadow-sm p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Restaurantes &amp; estado das contas
        </h2>

        {filtered.length === 0 ? (
          <p className="text-sm text-gray-500">
            Ainda não há subscrições registadas OU nenhuma pesquisa introduzida.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100 text-left">
                <tr>
                  <th className="px-3 py-2">Restaurante</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Criado em</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Próx. renovação</th>
                  <th className="px-3 py-2">Notas internas</th>
                  <th className="px-3 py-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-[11px] text-gray-500">ID: {r.id.slice(0, 8)}…</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs">{r.email}</span>
                    </td>
                    <td className="px-3 py-2 text-xs">{r.created_at}</td>
                    <td className="px-3 py-2">
                      <select
                        className="border rounded-lg px-2 py-1 text-xs"
                        value={r.status}
                        onChange={(e) => handleFieldChange(r.id, 'status', e.target.value)}
                      >
                        <option value="trial">Trial</option>
                        <option value="active">Ativo</option>
                        <option value="overdue">Em atraso</option>
                        <option value="cancelled">Cancelado</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="date"
                        className="border rounded-lg px-2 py-1 text-xs"
                        value={r.next_renewal}
                        onChange={(e) => handleFieldChange(r.id, 'next_renewal', e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => handleMarkMonthPaid(r.id)}
                        className="mt-1 block text-[11px] text-purple-600 hover:underline"
                      >
                        Marcar mês pago (+1 mês)
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <textarea
                        className="border rounded-lg px-2 py-1 text-xs w-52 h-16 resize-none"
                        placeholder="Notas para ti (ex: paga por transferência, falar com X, …)"
                        value={r.notes}
                        onChange={(e) => handleFieldChange(r.id, 'notes', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => handleSave(r)}
                        disabled={savingId === r.id}
                        className="bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white text-xs font-semibold px-3 py-1 rounded-lg"
                      >
                        {savingId === r.id ? 'A guardar…' : 'Guardar'}
                      </button>
                    </td>
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