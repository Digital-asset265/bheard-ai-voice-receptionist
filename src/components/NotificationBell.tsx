'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

type NotificationBellProps = {
  userId: string
  restaurantId?: string
}

type NotificationRow = {
  id: string
  title: string | null
  body: string | null
  type: string | null
  is_read: boolean | null
  created_at: string
}

export default function NotificationBell({
  userId,
  restaurantId,
}: NotificationBellProps) {
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  // Carregar notificações não lidas + últimas 10
  useEffect(() => {
    if (!userId) return

    const load = async () => {
      setLoading(true)

      const query = supabase
        .from('notifications')
        .select(
          'id, title, body, type, is_read, created_at',
          { count: 'exact' }
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10)

      const { data, error, count } = await query

      if (error) {
        console.error('Erro ao carregar notificações:', error)
      } else {
        setNotifications((data ?? []) as NotificationRow[])
        setUnreadCount(count ? count - (data ?? []).filter(n => n.is_read).length : 0)
      }

      setLoading(false)
    }

    load()
  }, [userId])

  // Subscrição em tempo real para novas notificações deste user
  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel(`notifications:user:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newNotif = payload.new as NotificationRow
          setNotifications((prev) => [newNotif, ...prev].slice(0, 10))
          setUnreadCount((prev) => prev + 1)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  const handleToggle = async () => {
    const show = !open
    setOpen(show)

    // Quando abrir, marcar todas como lidas
    if (show && unreadCount > 0) {
      try {
        await supabase
          .from('notifications')
          .update({ is_read: true })
          .eq('user_id', userId)
          .eq('is_read', false)

        setUnreadCount(0)
        setNotifications((prev) =>
          prev.map((n) => ({ ...n, is_read: true }))
        )
      } catch (err) {
        console.error('Erro ao marcar notificações como lidas:', err)
      }
    }
  }

  const label =
    unreadCount > 0
      ? `${unreadCount} notificação${unreadCount > 1 ? 's' : ''} por ler`
      : 'Sem novas notificações'

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleToggle}
        className="relative inline-flex items-center justify-center rounded-full border border-purple-300 bg-white px-3 py-2 text-sm hover:bg-purple-50"
        title={label}
      >
        <span className="text-lg">🔔</span>
        {unreadCount > 0 && (
          <span className="ml-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-xl border bg-white shadow-lg text-sm z-20">
          <div className="border-b px-3 py-2 font-semibold">
            Notificações
          </div>

          {loading && (
            <div className="px-3 py-3 text-xs text-gray-500">
              A carregar...
            </div>
          )}

          {!loading && notifications.length === 0 && (
            <div className="px-3 py-3 text-xs text-gray-500">
              Ainda não há notificações.
            </div>
          )}

          {!loading &&
            notifications.map((n) => (
              <div
                key={n.id}
                className={`px-3 py-2 border-t text-xs ${
                  n.is_read ? 'bg-white' : 'bg-purple-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {n.title || 'Atualização'}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {new Date(n.created_at).toLocaleTimeString('pt-PT', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                {n.body && (
                  <p className="mt-1 text-gray-700">{n.body}</p>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
