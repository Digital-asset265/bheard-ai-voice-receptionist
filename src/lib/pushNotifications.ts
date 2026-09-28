import { Capacitor } from '@capacitor/core'
import { supabase } from './supabaseClient'

const ONESIGNAL_APP_ID = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID || ''

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function getRestaurantIdForUser(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('restaurant_users')
    .select('restaurant_id')
    .eq('user_id', userId)
    .limit(1)

  if (error) {
    console.warn('Failed to load restaurant_id:', error)
    return null
  }
  return data?.[0]?.restaurant_id ?? null
}

async function getOneSignalSubscriptionId(OneSignal: any): Promise<string | null> {
  try {
    const id1 = OneSignal?.User?.pushSubscription?.id
    if (id1) return id1
  } catch {}

  try {
    const id2 = await OneSignal?.User?.pushSubscription?.getIdAsync?.()
    if (id2) return id2
  } catch {}

  try {
    const state = await new Promise<any>((resolve) => {
      if (!OneSignal?.getDeviceState) return resolve(null)
      OneSignal.getDeviceState((s: any) => resolve(s))
    })
    const id3 = state?.pushSubscriptionId || state?.userId
    if (id3) return id3
  } catch {}

  return null
}

function getDeviceNameSafe() {
  try {
    return (
      (navigator as any)?.userAgent ||
      (navigator as any)?.platform ||
      'unknown'
    ).slice(0, 180)
  } catch {
    return 'unknown'
  }
}

async function claimPushToken(params: {
  onesignal_subscription_id: string
  restaurant_id: string | null
  platform: string
  device_name: string
}) {
  // ✅ tenta RPC (forma correta de reassociar token a outro user)
  const { error: rpcErr } = await supabase.rpc('claim_push_token', {
    p_onesignal_subscription_id: params.onesignal_subscription_id,
    p_restaurant_id: params.restaurant_id,
    p_platform: params.platform,
    p_device_name: params.device_name,
  })

  if (!rpcErr) return

  console.warn('RPC claim_push_token falhou (fallback upsert):', rpcErr)

  // fallback: upsert direto (pode falhar com RLS/unique, mas não quebra a app)
  const { data: auth } = await supabase.auth.getUser()
  const user = auth?.user
  if (!user) return

  const { error } = await supabase.from('user_push_tokens').upsert(
    {
      user_id: user.id,
      restaurant_id: params.restaurant_id,
      onesignal_subscription_id: params.onesignal_subscription_id,
      platform: params.platform,
      device_name: params.device_name,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'onesignal_subscription_id' }
  )

  if (error) {
    console.warn('Falha a guardar push token (fallback upsert):', error)
  }
}

export async function initPushNotifications() {
  if (!Capacitor.isNativePlatform()) return
  if (!ONESIGNAL_APP_ID) {
    console.warn('NEXT_PUBLIC_ONESIGNAL_APP_ID em falta.')
    return
  }

  // Cordova plugin (Capacitor com Cordova plugins)
  const OneSignal = (window as any)?.plugins?.OneSignal
  if (!OneSignal) {
    console.warn('OneSignal plugin ainda não disponível no window.plugins.OneSignal.')
    return
  }

  try {
    // ✅ init
    OneSignal.initialize(ONESIGNAL_APP_ID)

    // ✅ permissões
    try {
      await OneSignal.Notifications?.requestPermission?.(true)
    } catch {
      try {
        OneSignal.Notifications?.requestPermission?.(true)
      } catch {}
    }

    // ✅ apanhar subscription id (pode demorar)
    let subId: string | null = null
    for (let i = 0; i < 12; i++) {
      subId = await getOneSignalSubscriptionId(OneSignal)
      if (subId) break
      await sleep(700)
    }

    if (!subId) {
      console.warn('OneSignal subscription id ainda não disponível.')
      return
    }

    // ✅ user atual
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return

    // ✅ restaurant/company id (no teu schema ainda chama restaurant_id)
    const restaurantId = await getRestaurantIdForUser(user.id)

    await claimPushToken({
      onesignal_subscription_id: subId,
      restaurant_id: restaurantId,
      platform: Capacitor.getPlatform(),
      device_name: getDeviceNameSafe(),
    })

    console.log('✅ Push token claimed para este user:', user.id, subId)
  } catch (e) {
    console.error('Failed to init OneSignal:', e)
  }
}