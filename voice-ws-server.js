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

const VAD_SILENCE_MS = Number(process.env.OPENAI_VAD_SILENCE_MS || 650);

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

function normalizeIndustryKey(industry) {
  const key = String(industry || 'roofing').toLowerCase().trim();

  return {
    dental: 'dentist',
    dental_clinic: 'dentist',
    dentistry: 'dentist',
  }[key] || key;
}

// ✅ validação mínima por indústria.
// Email continua opcional para não bloquear chamadas reais.
function getMissingLeadFields(industry, args, fallbackPhone) {
  const industryKey = normalizeIndustryKey(industry);
  const missing = [];

  if (!hasLen(args.full_name, 2)) missing.push('full_name');
  if (!hasLen(pickPhone(args.phone, fallbackPhone), 6)) missing.push('phone');

  if (industryKey === 'dentist') {
    if (!hasLen(args.reason_for_visit, 2)) missing.push('reason_for_visit');
    if (!hasLen(args.new_or_existing_patient, 2)) missing.push('new_or_existing_patient');
    return missing;
  }

  // default/roofing
  if (!hasLen(args.address, 5)) missing.push('address');
  if (!hasLen(args.problem_description, 3)) missing.push('problem_description');
  if (!hasLen(args.problem_type, 2)) missing.push('problem_type');
  if (!isSeverityValid(args.severity)) missing.push('severity');
  if (!isUrgencyValid(args.urgency)) missing.push('urgency');

  return missing;
}

function buildFollowUpForMissingFields(industry, missing) {
  if (!missing?.length) return null;

  const industryKey = normalizeIndustryKey(industry);
  const first = missing[0];

  if (industryKey === 'dentist') {
    switch (first) {
      case 'full_name':
        return 'Before I save this, what is your full name?';
      case 'phone':
        return 'Before I save this, what is the best phone number for the clinic to reach you on?';
      case 'reason_for_visit':
        return 'Before I save this, what is the reason for your visit? For example, cleaning, tooth pain, whitening, checkup, or something else.';
      case 'new_or_existing_patient':
        return 'Before I save this, are you a new or existing patient?';
      default:
        return 'Before I save this, I still need one more detail. Could you repeat that for me?';
    }
  }

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

function mapUrgencyForDb(industry, urgency) {
  const industryKey = normalizeIndustryKey(industry);
  const value = norm(urgency).toLowerCase();

  if (industryKey === 'dentist') {
    if (value === 'emergency') return 'immediate';
    if (value === 'soon') return '24h';
    if (value === 'flexible') return 'flexible';
  }

  return isUrgencyValid(value) ? value : '24h';
}

function mapSeverityForDb(industry, args) {
  const industryKey = normalizeIndustryKey(industry);

  if (industryKey === 'dentist') {
    const urgencyValue = norm(args.urgency).toLowerCase();
    return urgencyValue === 'emergency' ? 'high' : 'medium';
  }

  return isSeverityValid(args.severity) ? norm(args.severity) : 'medium';
}

function buildLeadDetails(industry, args) {
  const industryKey = normalizeIndustryKey(industry);

  if (industryKey === 'dentist') {
    return {
      industry: industry || 'dentist',
      reason_for_visit: norm(args.reason_for_visit) || null,
      preferred_date_or_time: norm(args.preferred_date_or_time) || null,
      urgency: norm(args.urgency) || null,
      new_or_existing_patient: norm(args.new_or_existing_patient) || null,
    };
  }

  return {
    industry: industry || 'roofing',
    address: norm(args.address) || null,
    problem_description: norm(args.problem_description) || null,
    problem_type: norm(args.problem_type) || null,
    severity: norm(args.severity) || 'medium',
    urgency: norm(args.urgency) || '24h',
  };
}

function buildLeadSummary(industry, args) {
  const industryKey = normalizeIndustryKey(industry);

  if (industryKey === 'dentist') {
    return norm(args.reason_for_visit) || 'Dental appointment request';
  }

  return norm(args.problem_description) || null;
}

function buildLeadProblemType(industry, args) {
  const industryKey = normalizeIndustryKey(industry);

  if (industryKey === 'dentist') {
    return norm(args.reason_for_visit) || 'dental appointment';
  }

  return norm(args.problem_type) || null;
}

// ✅ Lê company_knowledge com campos reais + is_active=true + ordenação
function getIndustryBehavior(industry) {
  const key = String(industry || 'roofing').toLowerCase().trim();

  const behaviors = {
    roofing: {
      companyType: 'US roofing company',
      companyKnowledgeLabel: 'COMPANY KNOWLEDGE FOR THIS SPECIFIC ROOFING COMPANY ONLY',
      businessContext: 'roofing, scheduling, services, or becoming a customer',
      servicesContext: 'roofing services',
      customerNeedContext: 'regarding your roof or the company',
      leadGoal: 'qualified roofing leads',
      leadTriggers: 'roofing problem, storm damage, leak, missing shingles, roof inspection request, roof repair request, roof replacement question, emergency issue, or wants someone to contact them',
      leadFields: 'full_name, phone, email, address, problem_description, problem_type, severity(low/medium/high), urgency(immediate/24h/flexible)',
      unavailableOffer: 'collect their details and have the team follow up',
      unrelatedRedirect: `I'm here to help with questions about this company and its roofing services. Is there anything I can help you with regarding your roof or the company?`,
    },

    dentist: {
      companyType: 'US dental clinic',
      companyKnowledgeLabel: 'COMPANY KNOWLEDGE FOR THIS SPECIFIC DENTAL CLINIC ONLY',
      businessContext: 'dental appointments, dental services, scheduling, patient questions, or becoming a patient',
      servicesContext: 'dental services',
      customerNeedContext: 'regarding your dental care, appointment, or the clinic',
      leadGoal: 'qualified dental appointment requests',
      leadTriggers: 'tooth pain, dental emergency, cleaning, checkup, whitening, implant consultation, braces or Invisalign, extraction, filling, crown, new patient appointment, existing patient question, or wants the clinic to contact them',
      leadFields: 'full_name, phone, email, reason_for_visit, preferred_date_or_time, urgency(emergency/soon/flexible), new_or_existing_patient',
      unavailableOffer: 'collect their details and have the team follow up',
      unrelatedRedirect: `I'm here to help with questions about this clinic, dental services, appointments, or becoming a patient. Is there anything I can help you with regarding your dental care or the clinic?`,
    },
  };

  const mappedKey = {
    dental: 'dentist',
    dental_clinic: 'dentist',
    dentistry: 'dentist',
  }[key] || key;

  return behaviors[mappedKey] || behaviors.roofing;
}

async function loadRestaurantIndustry(admin, restaurantId) {
  try {
    if (!restaurantId) return 'roofing';

    const { data, error } = await admin
      .from('restaurants')
      .select('industry')
      .eq('id', restaurantId)
      .maybeSingle();

    if (error) {
      console.warn('[Supabase] restaurant industry load warning', error.message || error);
      return 'roofing';
    }

    return data?.industry || 'roofing';
  } catch (e) {
    console.warn('[Supabase] restaurant industry load fatal', e?.message || e);
    return 'roofing';
  }
}

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
    let industry = 'roofing';

    // ✅ proteção contra duplicados na mesma chamada
    let leadCreationInFlight = false;
    let leadCreated = false;
    let createdLeadId = null;

    let companyKnowledgeInjected = false;
    let companyKnowledgeLoading = false;
    let aiReady = false;
    let greetingSent = false;

    const aiWs = connectOpenAIRealtime();

    // ✅ EXACTAMENTE o teu comportamento inicial (não mexer)
    function buildBaseInstructions(industryForCall) {
      const behavior = getIndustryBehavior(industryForCall);

      return (
      `You are BHeard, a warm, human-sounding AI front-desk receptionist for a ${behavior.companyType}. ` +
      `Always speak American English (en-US). Never speak Portuguese. ` +
      `Use short sentences. Sound natural, calm, helpful, and professional. ` +
      `You are a receptionist, not just a form collector. You can have an open, natural conversation while still guiding the caller toward the right outcome. ` +
      `Respond naturally after about 0.5–1 second when the caller has clearly finished speaking. ` +
      `Never interrupt the caller. If the caller sounds like they are still thinking, hesitating, searching for words, or about to add more, wait patiently. ` +
      `Do not speak during silence, background noise, hesitation sounds, or unclear audio. Only say "Of course, take your time" if the caller clearly says a phrase like "give me a second", "one moment", "let me think", or "hold on". Otherwise, stay silent and wait for the caller to finish. When collecting names, phone numbers, addresses, emails, or detailed descriptions, stay silent until the caller clearly finishes the full answer. Do not say "take your time" during partial numbers, addresses, spelling, or short pauses. ` +
      `Do not rush elderly, slow, nervous, or uncertain callers. Let them finish their full thought before responding. ` +
      `You may answer questions about the specific roofing company only when the answer is available in COMPANY KNOWLEDGE for this exact company. ` +
      `Never invent company facts. Never use information from another company. Never mix businesses. ` +
      `Never use general assumptions as if they were facts about the company. ` +
      `If the answer is not available in COMPANY KNOWLEDGE, say that you do not have that information available, but you can collect their details and have the team follow up. ` +
      `After answering any company question, always ask: "Is there anything else I can help you with?" Then wait silently for the caller. ` +

      `Do not claim the company offers a service, area, discount, warranty, emergency response, insurance help, financing, pricing, scheduling rules, or policies unless it is present in COMPANY KNOWLEDGE. ` +
      `If the caller asks an unrelated question that has nothing to do with the company, ${behavior.businessContext}, politely redirect them. ` +
      `For unrelated questions, say something like: "${behavior.unrelatedRedirect}" ` +
      `Do not debate, entertain random topics, or answer general trivia. Stay professional and redirect to the business context. ` +
      `Your main goal is to help the caller, answer company-related questions safely, and convert relevant calls into ${behavior.leadGoal}. ` +
      `If the caller has a ${behavior.leadTriggers}, begin lead qualification naturally. ` +
      `Do not interrogate the caller. Ask ONE question at a time, in a conversational way. ` +
      `Collect: ${behavior.leadFields}. ` +
      `If the caller does not want to provide email, continue without pushing too hard, but still collect the required fields needed to create the lead. ` +
      `When all required information is complete, call create_lead. ` +
      `If you ask "Is there anything else I can help you with?" and the caller clearly says they are finished, such as "No, that's all", "That's all, thank you", "No thank you", "Bye", or "Goodbye", first say: "You're very welcome. Thank you for calling. Have a wonderful day. Goodbye." Then call end_call. ` +
      `Never call end_call before saying goodbye. Never call end_call after simply answering a company question. Always wait for the caller to clearly confirm they are done.`
      );
    }

    let baseInstructions = buildBaseInstructions(industry);

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
            {
              type: 'function',
              name: 'end_call',
              description: 'Close the live Twilio call only after the assistant has already said a polite goodbye and the caller clearly confirmed they are done.',
              parameters: {
                type: 'object',
                properties: {},
              },
            },
          ],
        },
      };

      aiWs.send(JSON.stringify(sessionUpdate));
    }

    async function injectCompanyKnowledgeIfReady() {
      if (companyKnowledgeInjected || companyKnowledgeLoading) return;
      if (!restaurantId) return;
      if (aiWs.readyState !== WebSocket.OPEN) return;

      companyKnowledgeLoading = true;

      try {
        const companyKnowledge = await loadCompanyKnowledge(admin, restaurantId);

        if (companyKnowledge) {
          const behavior = getIndustryBehavior(industry);

          const augmentedInstructions =
            baseInstructions +
            ` ` +
            `\n\n${behavior.companyKnowledgeLabel}:\n` +
            companyKnowledge +
            `\n\nSTRICT COMPANY KNOWLEDGE RULES:\n` +
            `The COMPANY KNOWLEDGE above belongs only to the company associated with this exact call and this exact phone number. ` +
            `Use only this COMPANY KNOWLEDGE to answer questions about the business. ` +
            `Never use information from another company, another phone number, another account, or another industry. ` +
            `Never guess. ` +
            `Never invent pricing, service areas, schedules, guarantees, insurance details, emergency availability, warranties, discounts, or policies. ` +
            `If the caller asks something not covered in COMPANY KNOWLEDGE, say you do not have that information available, then offer to collect their details so the team can follow up. ` +
            `If the caller asks irrelevant or random questions outside the business context, politely redirect them back to the company, its ${behavior.servicesContext}, or whether they need help ${behavior.customerNeedContext}. ` +
            `If the caller asks about ${behavior.servicesContext}, availability, service areas, emergency help, process, company policies, appointments, scheduling, or anything related to this company, answer naturally using COMPANY KNOWLEDGE only. ` +
            `If the caller has a relevant need such as ${behavior.leadTriggers}, naturally guide the conversation toward collecting the required lead details one question at a time.`;

          sendSessionUpdate(augmentedInstructions);
          companyKnowledgeInjected = true;
          console.log('[AI] company_knowledge injected into session.update');
        } else {
          companyKnowledgeInjected = true;
          console.log('[AI] no company_knowledge found (no injection)');
        }
      } catch (e) {
        console.warn('[AI] failed to inject company_knowledge', e?.message || e);
      } finally {
        companyKnowledgeLoading = false;
      }
    }

    async function startGreetingIfReady() {
      if (greetingSent) return;
      if (!streamSid || !restaurantId) return;
      if (aiWs.readyState !== WebSocket.OPEN || !aiReady) return;

      await injectCompanyKnowledgeIfReady();

      greetingSent = true;
      aiWs.send(
        JSON.stringify({
          type: 'response.create',
          response: {
            instructions: `Answer the call now. Say: "Hi! Thanks for calling. How can I help you today?" Then pause and wait.`,
          },
        })
      );
    }

    aiWs.on('open', () => {
      console.log('[AI] connected');

      aiReady = true;
      sendSessionUpdate(baseInstructions);

      startGreetingIfReady().catch((e) =>
        console.warn('[AI] failed to start greeting after open', e?.message || e)
      );
    });

    aiWs.on('message', async (raw) => {
      const msg = safeJsonParse(raw.toString());
      if (!msg) return;

      if (msg.type === 'response.output_audio.delta' && msg.delta && streamSid) {
        twilioWs.send(JSON.stringify({ event: 'media', streamSid, media: { payload: msg.delta } }));
        return;
      }

      if (msg.type === 'response.function_call_arguments.done' && msg.name === 'end_call') {
        console.log('[AI] end_call requested - closing after goodbye', { callSid, leadCreated, createdLeadId });

        setTimeout(() => {
          try {
            if (twilioWs.readyState === WebSocket.OPEN) twilioWs.close();
          } catch {}

          try {
            if (aiWs.readyState === WebSocket.OPEN) aiWs.close();
          } catch {}
        }, 3500);

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
          const missingFields = getMissingLeadFields(industry, args, from);

          // ✅ só cria a lead quando os dados críticos estiverem mesmo completos
          if (missingFields.length > 0) {
            const followUp = buildFollowUpForMissingFields(industry, missingFields);
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
                    instructions: followUp,
                  },
                })
              );
            }
            return;
          }

          leadCreationInFlight = true;

          const industryKey = normalizeIndustryKey(industry);

          const insertPayload = {
            restaurant_id: restaurantId,
            industry: industryKey,
            full_name: norm(args.full_name) || null,
            phone: resolvedPhone,
            email: norm(args.email) || null,
            address: industryKey === 'roofing' ? norm(args.address) || null : null,
            problem_type: buildLeadProblemType(industryKey, args),
            urgency: mapUrgencyForDb(industryKey, args.urgency),
            severity: mapSeverityForDb(industryKey, args),
            status: 'new',
            summary: buildLeadSummary(industryKey, args),
            source: 'ai',
            lead_details: buildLeadDetails(industryKey, args),
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
          await callNotifyNewLead(leadId);

          console.log('[AI] lead created; no post-lead response.create sent');
        } catch (e) {
          console.error('[DB] lead insert error', e?.message || e);
          aiWs.send(
            JSON.stringify({
              type: 'response.create',
              response: {
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

        industry = await loadRestaurantIndustry(admin, restaurantId);
        console.log('[AI] industry loaded', { restaurantId, industry });

        baseInstructions = buildBaseInstructions(industry);
        console.log('[AI] base instructions built', { industry });

        await startGreetingIfReady();

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
