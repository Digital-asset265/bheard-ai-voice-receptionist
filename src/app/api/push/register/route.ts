import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'

export async function POST(req: Request) {
  const body = await req.json()
  const { onesignal_subscription_id, platform, device_name, restaurant_id } = body ?? {}

  if (!onesignal_subscription_id) {
    return NextResponse.json({ error: 'Missing onesignal_subscription_id' }, { status: 400 })
  }

  const { data: { user }, error: userErr } = await supabase.auth.getUser()
  if (userErr || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { error } = await supabase
    .from('user_push_tokens')
    .upsert({
      user_id: user.id,
      restaurant_id: restaurant_id ?? null,
      onesignal_subscription_id,
      platform: platform ?? null,
      device_name: device_name ?? null,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'onesignal_subscription_id' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
