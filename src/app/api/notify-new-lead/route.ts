// src/app/api/notify-new-lead/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { lead_id } = await req.json().catch(() => ({}));

    if (!lead_id) {
      return NextResponse.json({ error: 'lead_id em falta' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // ✅ NOVO: service role key (server-side only)
    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SERVICE_API_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: 'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY em falta' },
        { status: 500 }
      );
    }

    if (!serviceRoleKey) {
      return NextResponse.json(
        {
          error:
            'SUPABASE_SERVICE_ROLE_KEY em falta no .env.local (usa a "Copy service API key" [SECRET])',
        },
        { status: 500 }
      );
    }

    // Proxy server-side para a Edge Function (sem CORS)
    const fnUrl = `${supabaseUrl}/functions/v1/notify_new_lead`;

    // ✅ IMPORTANTE:
    // Para chamar functions via gateway, usa Authorization Bearer com uma key JWT (anon ou service).
    // Aqui usamos SERVICE ROLE para evitar problemas de JWT do user + RLS.
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ lead_id }),
    });

    const contentType = res.headers.get('content-type') || 'application/json';
    const text = await res.text();

    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': contentType },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Erro inesperado na API route' },
      { status: 500 }
    );
  }
}
