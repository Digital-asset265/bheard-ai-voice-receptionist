// lib/registerDevice.ts
import { supabase } from './supabaseClient'

export async function registerDeviceWithOneSignal(userId: string) {
  const OneSignal = (window as any).OneSignal
  if (!OneSignal) return

  // Nota: em versões diferentes o getter muda.
  // Uma abordagem comum é pedir o "device state"
  OneSignal.getDeviceState?.(async (state: any) => {
    const playerId = state?.userId // muitas versões expõem assim
    if (!playerId) return

    await supabase.from('user_devices').upsert(
      {
        user_id: userId,
        player_id: playerId,
        platform: 'android',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
  })
}
