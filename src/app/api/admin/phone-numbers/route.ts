import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const ADMIN_EMAIL = 'andrepeixoto265@gmail.com'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY! // ⚠️ só no server

// client admin (bypass RLS)
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

function cleanPhoneE164(input: string) {
  const raw = (input || '').trim()
  return raw.replace(/[^\d+]/g, '')
}

function looksLikeE164(phone: string) {
  if (!phone?.startsWith('+')) return false
  const digits = phone.slice(1).replace(/\D/g, '')
  return digits.length >= 8 && digits.length <= 15
}

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const adminEmail = (body?.adminEmail || '').toLowerCase().trim()
    if (adminEmail !== ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const ownerEmail = (body?.ownerEmail || '').toLowerCase().trim()
    const restaurantId = body?.restaurantId as string | null
    const provider = (body?.provider || 'twilio') as string
    const friendlyName = (body?.friendlyName || '').trim() || null
    const phoneNumber = cleanPhoneE164(body?.phoneNumber || '')

    if (!ownerEmail || !ownerEmail.includes('@')) {
      return NextResponse.json({ error: 'Owner email inválido.' }, { status: 400 })
    }

    if (!restaurantId) {
      return NextResponse.json({ error: 'restaurantId em falta.' }, { status: 400 })
    }

    if (!looksLikeE164(phoneNumber)) {
      return NextResponse.json({ error: 'Número inválido. Usa E.164 (+...).' }, { status: 400 })
    }

    // ✅ Verifica se este owner é mesmo owner “aceite” com restaurant_id (fonte: invites)
    const { data: inv, error: invErr } = await supabaseAdmin
      .from('invites')
      .select('id, email, role, status, restaurant_id')
      .eq('status', 'accepted')
      .eq('role', 'owner')
      .eq('email', ownerEmail)
      .maybeSingle()

    if (invErr) {
      return NextResponse.json({ error: invErr.message }, { status: 500 })
    }

    if (!inv || !inv.restaurant_id) {
      return NextResponse.json({ error: 'Este email não é owner válido (invites).' }, { status: 400 })
    }

    // ✅ EXTRA segurança: garantir que o restaurantId recebido bate com o do invite
    if (inv.restaurant_id !== restaurantId) {
      return NextResponse.json(
        { error: 'restaurantId não bate com o owner selecionado.' },
        { status: 400 }
      )
    }

    // ✅ Garante que não existe número ativo igual
    const { data: existing, error: exErr } = await supabaseAdmin
      .from('phone_numbers')
      .select('id, restaurant_id, phone_number, active')
      .eq('phone_number', phoneNumber)
      .eq('active', true)
      .maybeSingle()

    if (exErr) {
      return NextResponse.json({ error: exErr.message }, { status: 500 })
    }
    if (existing) {
      return NextResponse.json(
        { error: `Este número já está ativo (restaurant_id=${(existing as any).restaurant_id}).` },
        { status: 400 }
      )
    }

    // ✅ Insere (bypass RLS)
    const payload: any = {
      restaurant_id: restaurantId,
      phone_number: phoneNumber,
      provider,
      active: true,
      updated_at: new Date().toISOString(),
      friendly_name: friendlyName,
    }

    const { error: insErr } = await supabaseAdmin.from('phone_numbers').insert(payload)
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 })
  }
}