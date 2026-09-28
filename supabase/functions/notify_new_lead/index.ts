// @ts-nocheck
// deno-lint-ignore-file
// supabase/functions/notify_new_lead/index.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

function json(data: Json, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    },
  });
}

function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function dedupeStrings(arr: string[]) {
  return Array.from(new Set(arr.filter((x) => typeof x === "string" && x.length)));
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST")
    return json({ ok: false, error: "Método não permitido" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      Deno.env.get("SUPABASE_SERVICE_KEY") ||
      Deno.env.get("SUPABASE_SERVICE_API_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return json(
        {
          ok: false,
          error: "Faltam envs: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
        },
        500,
      );
    }

    const onesignalAppId =
      Deno.env.get("ONESIGNAL_APP_ID") ||
      Deno.env.get("NEXT_PUBLIC_ONESIGNAL_APP_ID");

    const onesignalRestKey = Deno.env.get("ONESIGNAL_REST_API_KEY");

    if (!onesignalAppId || !onesignalRestKey) {
      return json(
        {
          ok: false,
          error: "Faltam envs: ONESIGNAL_APP_ID e/ou ONESIGNAL_REST_API_KEY",
        },
        500,
      );
    }

    const body = await req.json().catch(() => ({}));
    const lead_id = (body?.lead_id as string) || "";
    if (!lead_id) return json({ ok: false, error: "lead_id em falta" }, 400);

    // ✅ Service Role client (sem RLS)
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) Buscar lead
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select(
        "id, restaurant_id, created_by, full_name, phone, problem_type, urgency, severity",
      )
      .eq("id", lead_id)
      .maybeSingle();

    if (leadErr)
      return json(
        { ok: false, error: "Erro a buscar lead", details: leadErr.message },
        500,
      );
    if (!lead) return json({ ok: false, error: "Lead não encontrada" }, 404);

    const restaurantId = (lead.restaurant_id as string | null) || null;
    const createdBy = (lead.created_by as string | null) || null;

    if (!restaurantId) {
      return json({ ok: false, error: "Lead sem restaurant_id" }, 400);
    }

    // 2) Buscar membros do restaurante (exclui quem criou, se existir)
    let ruQuery = supabase
      .from("restaurant_users")
      .select("user_id")
      .eq("restaurant_id", restaurantId);

    if (createdBy) ruQuery = ruQuery.neq("user_id", createdBy);

    const { data: members, error: membersErr } = await ruQuery;

    if (membersErr) {
      return json(
        {
          ok: false,
          error: "Erro a buscar restaurant_users",
          details: membersErr.message,
        },
        500,
      );
    }

    const userIds = (members || []).map((m: any) => m.user_id).filter(Boolean);
    if (userIds.length === 0) {
      return json(
        { ok: true, skipped: true, reason: "Sem membros para notificar" },
        200,
      );
    }

    // 3) ✅ Preferência: user_push_tokens.onesignal_subscription_id
    // fallback legacy: user_devices.player_id
    let subscriptionIds: string[] = [];
    let used = "user_push_tokens";

    try {
      const { data: tokens, error: tokErr } = await supabase
        .from("user_push_tokens")
        .select("onesignal_subscription_id, user_id")
        .in("user_id", userIds);

      if (!tokErr && tokens?.length) {
        subscriptionIds = (tokens as any[])
          .map((t) => t.onesignal_subscription_id)
          .filter((x) => typeof x === "string" && x.length > 5);
      }
    } catch {
      // ignora
    }

    if (subscriptionIds.length === 0) {
      used = "user_devices";
      try {
        const { data: devices, error: devErr } = await supabase
          .from("user_devices")
          .select("player_id, provider, user_id")
          .in("user_id", userIds)
          .eq("provider", "onesignal");

        if (devErr) {
          return json(
            {
              ok: false,
              error: "Erro a buscar user_devices",
              details: devErr.message,
            },
            500,
          );
        }

        subscriptionIds = (devices || [])
          .map((d: any) => d.player_id)
          .filter((p) => typeof p === "string" && p.length > 5);
      } catch {
        // ignora
      }
    }

    subscriptionIds = dedupeStrings(subscriptionIds);

    if (subscriptionIds.length === 0) {
      return json(
        {
          ok: true,
          skipped: true,
          reason: "Sem destinatários OneSignal (subscription_id/player_id)",
          used,
        },
        200,
      );
    }

    // 4) Enviar push via OneSignal
    const title = "New lead";
    const customer = (lead.full_name as string) || "Customer";
    const phone = (lead.phone as string) || "";
    const severity = (lead.severity as string) || "";
    const urgency = (lead.urgency as string) || "";
    const prob = (lead.problem_type as string) || "";

    const msg = `${customer}${phone ? ` — ${phone}` : ""}${prob ? ` • ${prob}` : ""}${
      severity ? ` • ${severity}` : ""
    }${urgency ? ` • ${urgency}` : ""}`;

    // ✅ chunk por segurança (limites práticos)
    const CHUNK_SIZE = 2000;
    const batches = chunk(subscriptionIds, CHUNK_SIZE);

    const results: any[] = [];
    let notifiedTotal = 0;

    for (const batch of batches) {
      const payload: Record<string, unknown> = {
        app_id: onesignalAppId,
        include_subscription_ids: batch,
        headings: { en: title, pt: title },
        contents: { en: msg, pt: msg },
        data: { lead_id: lead.id, restaurant_id: restaurantId },
      };

      const osRes = await fetch("https://onesignal.com/api/v1/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${onesignalRestKey}`,
        },
        body: JSON.stringify(payload),
      });

      const osText = await osRes.text().catch(() => "");
      if (!osRes.ok) {
        return json(
          {
            ok: false,
            error: "OneSignal falhou",
            status: osRes.status,
            details: osText.slice(0, 800),
            used,
            batch_size: batch.length,
          },
          500,
        );
      }

      let parsed: unknown = null;
      try {
        parsed = osText ? JSON.parse(osText) : null;
      } catch {
        parsed = osText || null;
      }

      results.push(parsed);
      notifiedTotal += batch.length;
    }

    return json(
      {
        ok: true,
        notified: notifiedTotal,
        used,
        onesignal: results.length === 1 ? results[0] : results,
      },
      200,
    );
  } catch (e) {
    return json(
      {
        ok: false,
        error: "Erro inesperado",
        details: String((e as any)?.message || e),
      },
      500,
    );
  }
});