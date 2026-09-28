import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

function twimlResponse(xml: string) {
  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

// Server-only supabase (bypass RLS)
function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  if (!service) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

  return createClient(url, service, {
    auth: { persistSession: false },
  });
}

function safeSayTwiml(text: string) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="pt-PT" voice="alice">${text}</Say>
</Response>`;

  return twimlResponse(xml);
}

export async function POST(req: Request) {
  try {
    const bodyText = await req.text();
    const params = new URLSearchParams(bodyText);

    const callSid = params.get('CallSid') || '';
    const from = params.get('From') || '';
    const to = params.get('To') || '';

    // WebSocket público (ngrok) que encaminha para /twilio-stream
    const streamUrl = process.env.TWILIO_STREAM_WSS_URL;

    console.log('[Twilio Voice Webhook] incoming', {
      callSid,
      from,
      to,
      streamUrl,
    });

    if (!streamUrl) {
      return safeSayTwiml(
        'Erro de configuração: falta a variável TWILIO_STREAM_WSS_URL no servidor.'
      );
    }

    if (!streamUrl.startsWith('wss://')) {
      return safeSayTwiml(
        'Erro de configuração: o TWILIO_STREAM_WSS_URL tem de começar por wss://'
      );
    }

    const admin = supabaseAdmin();

    // Descobre a empresa associada ao número Twilio chamado
    const { data: pn, error: pnErr } = await admin
      .from('phone_numbers')
      .select('restaurant_id, phone_number, active, provider')
      .eq('phone_number', to)
      .eq('active', true)
      .maybeSingle();

    if (pnErr) {
      console.error('[Supabase] phone_numbers lookup error', pnErr);

      return safeSayTwiml(
        'Erro técnico ao validar o número. Tente novamente em instantes.'
      );
    }

    if (!pn?.restaurant_id) {
      console.warn('[Supabase] No mapping for this Twilio number', {
        to,
      });

      return safeSayTwiml(
        'Este número ainda não está associado a nenhuma conta. Por favor contacte o suporte.'
      );
    }

    const restaurantId = pn.restaurant_id as string;

    // TwiML: liga a chamada ao WebSocket da BHeard
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="restaurant_id" value="${restaurantId}" />
      <Parameter name="from" value="${from}" />
      <Parameter name="to" value="${to}" />
      <Parameter name="callSid" value="${callSid}" />
    </Stream>
  </Connect>
</Response>`;

    console.log('[Twilio Voice Webhook] ok', {
      callSid,
      restaurantId,
      from,
      to,
      streamUrl,
    });

    return twimlResponse(xml);
  } catch (e: any) {
    console.error(
      '[Twilio Voice Webhook] fatal error',
      e?.message || e,
      e
    );

    return safeSayTwiml(
      'Erro interno no servidor. Tente novamente dentro de momentos.'
    );
  }
}