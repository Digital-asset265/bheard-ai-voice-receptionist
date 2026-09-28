/* eslint-disable no-console */
require('dotenv').config({ path: '.env.local' });

const http = require('http');
const next = require('next');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const PORT = 3001;
const WS_PATH = '/twilio-stream';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ✅ Edge Functions base URL
const SUPABASE_FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL || `${SUPABASE_URL}/functions/v1`;

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime';

// ✅ formatos válidos
const INPUT_AUDIO_FORMAT = process.env.OPENAI_INPUT_AUDIO_FORMAT || 'g711_ulaw';
const OUTPUT_AUDIO_FORMAT = process.env.OPENAI_OUTPUT_AUDIO_FORMAT || 'g711_ulaw';

const VOICE = process.env.OPENAI_VOICE || 'alloy';

// clamp temp >= 0.6
const RAW_TEMP = Number(process.env.OPENAI_TEMPERATURE || 0.7);
const TEMPERATURE = Number.isFinite(RAW_TEMP) ? Math.max(0.6, RAW_TEMP) : 0.7;

const VAD_SILENCE_MS = Number(process.env.OPENAI_VAD_SILENCE_MS || 1600);

// quantos registos de knowledge carregar (podes ajustar via env)
const KNOWLEDGE_LIMIT = Number(process.env.KNOWLEDGE_LIMIT || 50);

if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
if (!SUPABASE_URL) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

function supabaseAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function connectOpenAIRealtime() {
  const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}`;
  return new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
  });
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function norm(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function phoneNorm(v) {
  return norm(v).replace(/[^\d+]/g, '');
}

function pickPhone(argsPhone, fromPhone) {
  return norm(argsPhone) || norm(fromPhone) || '';
}

function hasLen(v, min) {
  return norm(v).length >= min;
}

function isSeverityValid(v) {
  return ['low', 'medium', 'high'].includes(norm(v));
}

function isUrgencyValid(v) {
  return ['immediate', '24h', 'flexible'].includes(norm(v));
}

// ✅ validação mínima para garantir que só cria a lead final e completa
// Mantém email opcional para não bloquear chamadas reais se o cliente não quiser dar email.
function getMissingLeadFields(args, fallbackPhone) {
  const missing = [];

  if (!hasLen(args.full_name, 2)) missing.push('full_name');
  if (!hasLen(pickPhone(args.phone, fallbackPhone), 6)) missing.push('phone');
  if (!hasLen(args.address, 5)) missing.push('address');
  if (!hasLen(args.problem_description, 8)) missing.push('problem_description');
  if (!hasLen(args.problem_type, 2)) missing.push('problem_type');
  if (!isSeverityValid(args.severity)) missing.push('severity');
  if (!isUrgencyValid(args.urgency)) missing.push('urgency');

  return missing;
}

function buildFollowUpForMissingFields(missing) {
  if (!missing?.length) return null;

  const first = missing[0];

  switch (first) {
    case 'full_name':
      return 'Before I save this, what is your full name?';
    case 'phone':
      return 'Before I save this, what is the best phone number for the team to reach you on?';
    case 'address':
      return 'Before I save this, what is the property address for this roofing issue?';
    case 'problem_description':
      return 'Before I save this, please briefly describe what is happening with the roof.';
    case 'problem_type':
      return 'Before I save this, what type of roofing problem is it? For example, a leak, storm damage, missing shingles, or something else.';
    case 'severity':
      return 'Before I save this, would you say the issue is low, medium, or high severity?';
    case 'urgency':
      return 'Before I save this, how urgent is it: immediate, within 24 hours, or flexible?';
    default:
      return 'Before I save this, I still need one more detail. Could you repeat that for me?';
  }
}

// ✅ Lê company_knowledge com campos reais + is_active=true + ordenação
async function loadCompanyKnowledge(admin, restaurantId) {
  try {
    const { data, error } = await admin
      .from('company_knowledge')
      .select('category, title, content, is_active, created_at')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(KNOWLEDGE_LIMIT);

    if (error) {
      console.warn('[Supabase] company_knowledge load warning', error.message || error);
      return null;
    }
    if (!data || !data.length) return null;

    const byCat = new Map();
    for (const row of data) {
      const cat = (row.category || 'other').toString();
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(row);
    }

    const preferredOrder = [
      'hours',
      'services',
      'areas',
      'emergency',
      'pricing_rules',
      'policies',
      'faq',
      'other',
    ];

    const cats = Array.from(byCat.keys()).sort((a, b) => {
      const ia = preferredOrder.indexOf(a);
      const ib = preferredOrder.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    const lines = [];
    for (const cat of cats) {
      const arr = byCat.get(cat) || [];
      lines.push(`\n## ${cat.toUpperCase()}\n`);
      for (const item of arr) {
        const t = (item.title || '').toString().trim();
        const header = t ? `- ${t}:` : `- (no title):`;
        const content = (item.content || '').toString().trim();
        if (!content) continue;
        lines.push(`${header}\n${content}\n`);
      }
    }

    const text = lines.join('\n').trim();
    return text || null;
  } catch (e) {
    console.warn('[Supabase] company_knowledge load exception', e?.message || e);
    return null;
  }
}

// ✅ Dispara push chamando Edge Function diretamente
async function callNotifyNewLead(leadId) {
  const url = `${SUPABASE_FUNCTIONS_URL}/notify_new_lead`;

  if (!leadId) {
    console.warn('[Notify] leadId missing -> not calling function', { url });
    return;
  }

  try {
    console.log('[Notify] calling notify_new_lead', { url, leadId });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ lead_id: leadId }),
    });

    const text = await res.text().catch(() => '');

    if (!res.ok) {
      console.error('[Notify] function FAILED', { status: res.status, body: text?.slice(0, 1200) });
      return;
    }

    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text || null;
    }

    console.log('[Notify] function OK', parsed);
  } catch (e) {
    console.error('[Notify] call error', e?.message || e);
  }
}

// ✅ fallback: se insert não devolver id, tenta descobrir a lead criada agora
async function fallbackFindLeadId(admin, restaurantId, email, phone) {
  try {
    const q = admin
      .from('leads')
      .select('id, created_at, email, phone')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false })
      .limit(5);

    const { data, error } = await q;
    if (error) {
      console.warn('[DB] fallback query error', error.message || error);
      return null;
    }
    if (!data?.length) return null;

    const emailNorm = (email || '').toString().trim().toLowerCase();
    const phoneNormValue = (phone || '').toString().replace(/[^\d+]/g, '');

    // tenta casar por email/phone (melhor)
    const hit =
      data.find((r) => (r.email || '').toString().trim().toLowerCase() === emailNorm) ||
      data.find((r) => ((r.phone || '').toString().replace(/[^\d+]/g, '') === phoneNormValue));

    return (hit?.id || data[0]?.id) ?? null;
  } catch (e) {
    console.warn('[DB] fallback exception', e?.message || e);
    return null;
  }
}

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = http.createServer((req, res) => handle(req, res));

  const wss = new WebSocket.Server({ server, path: WS_PATH });

  console.log('✅ voice-ws-server BOOT: notify+logs enabled v2'); // <-- marcador para confirmares que corre o ficheiro certo
  console.log(`✅ Next + WS on http://localhost:${PORT}`);
  console.log(`✅ WS path: ws://localhost:${PORT}${WS_PATH}`);
  console.log(`🎛️ audio: in=${INPUT_AUDIO_FORMAT} out=${OUTPUT_AUDIO_FORMAT}`);
  console.log(`🗣️ voice=${VOICE} temp=${TEMPERATURE} (raw=${RAW_TEMP}) vad_silence_ms=${VAD_SILENCE_MS}`);
  console.log(`📚 knowledge_limit=${KNOWLEDGE_LIMIT}`);
  console.log(`🔔 functions_url=${SUPABASE_FUNCTIONS_URL}`);

  wss.on('connection', (twilioWs) => {
    console.log('[WS] Twilio connected');
    const admin = supabaseAdmin();

    let streamSid = null;
    let restaurantId = null;
    let from = null;
    let to = null;
    let callSid = null;

    // ✅ proteção contra duplicados na mesma chamada
    let leadCreationInFlight = false;
    let leadCreated = false;
    let createdLeadId = null;

    const aiWs = connectOpenAIRealtime();

    // ✅ EXACTAMENTE o teu comportamento inicial (não mexer)
    const baseInstructions =
      `You are a warm, human-sounding front-desk receptionist for a US roofing company. ` +
      `Always speak American English (en-US). Never speak Portuguese. ` +
      `Use short sentences. Don’t interrupt slow speakers. Wait ~1.5–2 seconds after they finish. ` +
      `Collect: full_name, phone, email, address, problem_description, problem_type, severity(low/medium/high), urgency(immediate/24h/flexible). ` +
      `When complete, call create_lead. Ask ONE question at a time.`;

    function sendSessionUpdate(instructions) {
      const sessionUpdate = {
        type: 'session.update',
        session: {
          type: 'realtime',
	  model: REALTIME_MODEL,
	  output_modalities: ['audio'],
	  audio: {
	   input: {
	    format: { type: 'audio/pcmu' },
	    turn_detection: {type: 'server_vad', silence_duration_ms: VAD_SILENCE_MS },
	   },
	  output: {
	    format: {type: 'audio/pcmu' },
	    voice: VOICE,
	   },
	  },
          instructions,
          tools: [
            {
              type: 'function',
              name: 'create_lead',
              description: 'Create a new lead in the system',
              parameters: {
                type: 'object',
                properties: {
                  full_name: { type: 'string' },
                  phone: { type: 'string' },
                  email: { type: 'string' },
                  address: { type: 'string' },
                  problem_description: { type: 'string' },
                  problem_type: { type: 'string' },
                  severity: { type: 'string', enum: ['low', 'medium', 'high'] },
                  urgency: { type: 'string', enum: ['immediate', '24h', 'flexible'] },
                },
                required: [
                  'full_name',
                  'phone',
                  'email',
                  'address',
                  'problem_description',
                  'problem_type',
                  'severity',
                  'urgency',
                ],
              },
            },
          ],
        },
      };

      aiWs.send(JSON.stringify(sessionUpdate));
    }

    aiWs.on('open', () => {
      console.log('[AI] connected');

      // ✅ mantém comportamento e greeting
      sendSessionUpdate(baseInstructions);

      aiWs.send(
        JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['audio', 'text'],
            instructions: `Answer the call now. Say: "Hi! Thanks for calling. How can I help you today?" Then pause and wait.`,
          },
        })
      );
    });

    aiWs.on('message', async (raw) => {
      const msg = safeJsonParse(raw.toString());
      if (!msg) return;

      if (msg.type === 'response.output_audiodelta' && msg.delta && streamSid) {
        twilioWs.send(JSON.stringify({ event: 'media', streamSid, media: { payload: msg.delta } }));
        return;
      }

      if (msg.type === 'response.function_call_arguments.done' && msg.name === 'create_lead') {
        const args = safeJsonParse(msg.arguments || '{}') || {};
        console.log('[AI] create_lead args', args);

        // ✅ impedir mais do que uma lead por chamada
        if (leadCreated || leadCreationInFlight) {
          console.warn('[DB] create_lead ignored (already created/in-flight)', {
            leadCreated,
            leadCreationInFlight,
            createdLeadId,
            callSid,
          });
          return;
        }

        try {
          if (!restaurantId) throw new Error('Missing restaurant_id');

          const resolvedPhone = pickPhone(args.phone, from);
          const missingFields = getMissingLeadFields(args, from);

          // ✅ só cria a lead quando os dados críticos estiverem mesmo completos
          if (missingFields.length > 0) {
            const followUp = buildFollowUpForMissingFields(missingFields);
            console.warn('[DB] create_lead blocked (missing required data)', {
              missingFields,
              callSid,
              restaurantId,
              from,
            });

            if (followUp) {
              aiWs.send(
                JSON.stringify({
                  type: 'response.create',
                  response: {
                    modalities: ['audio', 'text'],
                    instructions: followUp,
                  },
                })
              );
            }
            return;
          }

          leadCreationInFlight = true;

          const insertPayload = {
            restaurant_id: restaurantId,
            full_name: norm(args.full_name) || null,
            phone: resolvedPhone,
            email: norm(args.email) || null,
            address: norm(args.address) || null,
            problem_type: norm(args.problem_type) || null,
            urgency: norm(args.urgency) || '24h',
            severity: norm(args.severity) || 'medium',
            status: 'new',
            summary: norm(args.problem_description) || null,
            source: 'ai',
          };

          console.log('[DB] inserting lead...', {
            callSid,
            restaurantId,
            email: insertPayload.email,
            phone: insertPayload.phone,
            full_name: insertPayload.full_name,
            problem_type: insertPayload.problem_type,
            urgency: insertPayload.urgency,
            severity: insertPayload.severity,
          });

          // tenta devolver id
          let leadId = null;
          const { data: inserted, error } = await admin
            .from('leads')
            .insert(insertPayload)
            .select('id')
            .maybeSingle();

          if (error) throw error;
          leadId = inserted?.id || null;

          if (!leadId) {
            console.warn('[DB] insert returned no id -> fallback lookup');
            leadId = await fallbackFindLeadId(admin, restaurantId, insertPayload.email, insertPayload.phone);
          }

          createdLeadId = leadId || null;
          leadCreated = !!leadId;

          console.log('[DB] lead inserted', { leadId, callSid });

          // chama notify (não bloqueia conversa)
          callNotifyNewLead(leadId).catch(() => {});

          aiWs.send(
            JSON.stringify({
              type: 'response.create',
              response: {
                modalities: ['audio', 'text'],
                instructions: `Perfect — I’ve got everything. We’ll get this over to the team right away. Thank you!`,
              },
            })
          );
        } catch (e) {
          console.error('[DB] lead insert error', e?.message || e);
          aiWs.send(
            JSON.stringify({
              type: 'response.create',
              response: {
                modalities: ['audio', 'text'],
                instructions: `I had a technical issue saving that. Could you repeat your phone number slowly?`,
              },
            })
          );
        } finally {
          leadCreationInFlight = false;
        }
      }

      if (msg.type === 'error') console.error('[AI] error', msg);
    });

    aiWs.on('close', () => console.log('[AI] disconnected'));
    aiWs.on('error', (e) => console.error('[AI] ws error', e));

    twilioWs.on('message', async (raw) => {
      const msg = safeJsonParse(raw.toString());
      if (!msg) return;

      if (msg.event === 'start') {
        streamSid = msg.start?.streamSid || null;
        const cp = msg.start?.customParameters || {};
        restaurantId = cp.restaurant_id || null;
        from = cp.from || null;
        to = cp.to || null;
        callSid = cp.callSid || null;
        console.log('[Twilio] start', { streamSid, restaurantId, from, to, callSid });

        // inject company knowledge sem mexer no comportamento
        try {
          if (restaurantId && aiWs.readyState === WebSocket.OPEN) {
            const companyKnowledge = await loadCompanyKnowledge(admin, restaurantId);

            if (companyKnowledge) {
              const augmentedInstructions =
                baseInstructions +
                ` ` +
                `\n\nCOMPANY KNOWLEDGE (use this to answer questions if asked):\n` +
                companyKnowledge +
                `\n\nIf the answer is not in the COMPANY KNOWLEDGE, do not guess. Ask ONE clarifying question.`;

              sendSessionUpdate(augmentedInstructions);
              console.log('[AI] company_knowledge injected into session.update');
            } else {
              console.log('[AI] no company_knowledge found (no injection)');
            }
          }
        } catch (e) {
          console.warn('[AI] failed to inject company_knowledge', e?.message || e);
        }

        return;
      }

      if (msg.event === 'media') {
        if (aiWs.readyState === WebSocket.OPEN && msg.media?.payload) {
          aiWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: msg.media.payload }));
        }
        return;
      }

      if (msg.event === 'stop') {
        console.log('[Twilio] stop', { callSid, leadCreated, createdLeadId });
        try {
          if (aiWs.readyState === WebSocket.OPEN) aiWs.close();
        } catch {}
      }
    });

    twilioWs.on('close', () => {
      console.log('[WS] Twilio disconnected', { callSid, leadCreated, createdLeadId });
      try {
        aiWs.close();
      } catch {}
    });

    twilioWs.on('error', (e) => console.error('[WS] Twilio ws error', e));
  });

  server.listen(PORT, () => console.log(`🚀 Server ready on http://localhost:${PORT}`));
});
