'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type IndustryKey =
  | 'roofing'
  | 'dental'
  | 'hvac'
  | 'plumbing'
  | 'electrician'
  | 'pest_control'
  | 'landscaping'
  | 'home_cleaning'
  | 'garage_door'
  | 'general_contractor';

const INDUSTRY_OPTIONS: { key: IndustryKey; label: string; description: string }[] = [
  { key: 'roofing', label: 'Roofing', description: 'Roof repairs, replacements, leaks, storm damage.' },
  { key: 'dental', label: 'Dental Clinic', description: 'Appointments, patient enquiries, dental emergencies.' },
  { key: 'hvac', label: 'HVAC', description: 'Heating, cooling, AC repair, installations.' },
  { key: 'plumbing', label: 'Plumbing', description: 'Leaks, drains, water heaters, emergency plumbing.' },
  { key: 'electrician', label: 'Electrician', description: 'Electrical repairs, installations, urgent issues.' },
  { key: 'pest_control', label: 'Pest Control', description: 'Infestations, inspections, treatment requests.' },
  { key: 'landscaping', label: 'Landscaping', description: 'Lawn care, maintenance, outdoor projects.' },
  { key: 'home_cleaning', label: 'Home Cleaning', description: 'Cleaning requests, recurring service, move-in/move-out.' },
  { key: 'garage_door', label: 'Garage Door', description: 'Repairs, broken springs, opener issues, installations.' },
  { key: 'general_contractor', label: 'General Contractor', description: 'Renovations, repairs, project enquiries.' },
];

function industryLabel(key: string | null | undefined) {
  return INDUSTRY_OPTIONS.find((x) => x.key === key)?.label ?? 'Roofing';
}

type KnowledgeRow = {
  id: string;
  restaurant_id: string;
  category: string;
  title: string | null;
  content: string;
  is_active: boolean;
  created_at: string;
};

const CATEGORY_PRESETS = [
  { key: 'services', label: 'Services' },
  { key: 'areas', label: 'Service Areas' },
  { key: 'hours', label: 'Business Hours' },
  { key: 'emergency', label: 'Emergency / After-hours' },
  { key: 'pricing_rules', label: 'Pricing Rules' },
  { key: 'faq', label: 'FAQ' },
  { key: 'policies', label: 'Policies / Warranty' },
];

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
const DAYS: { key: DayKey; label: string }[] = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

type HoursRow = { day: DayKey; open: boolean; start: string; end: string };

function formatTimeLabel(t: string) {
  // input type="time" gives "HH:MM"
  if (!t) return '';
  return t;
}

function buildHoursContent(rows: HoursRow[], notes: string) {
  const lines: string[] = [];
  for (const d of DAYS) {
    const r = rows.find((x) => x.day === d.key);
    if (!r) continue;
    if (!r.open) {
      lines.push(`${d.label}: Closed`);
      continue;
    }
    const start = formatTimeLabel(r.start);
    const end = formatTimeLabel(r.end);
    if (!start || !end) {
      lines.push(`${d.label}: Open (hours not set)`);
      continue;
    }
    lines.push(`${d.label}: ${start} - ${end}`);
  }

  if (notes.trim()) {
    lines.push('');
    lines.push(`Notes: ${notes.trim()}`);
  }

  return lines.join('\n').trim();
}

// --- NEW: helper to find the “current hours row” (most recent) ---
function pickMostRecent(rows: KnowledgeRow[]) {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
}

export default function CompanyInfoPage() {
  const router = useRouter();

  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>('—');
  const [industry, setIndustry] = useState<IndustryKey>('roofing');
  const [savingIndustry, setSavingIndustry] = useState(false);

  const [items, setItems] = useState<KnowledgeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create
  const [category, setCategory] = useState(CATEGORY_PRESETS[0].key);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // ✅ Hours builder (only used when category === 'hours')
  const [hoursRows, setHoursRows] = useState<HoursRow[]>(
    DAYS.map((d) => ({ day: d.key, open: d.key !== 'sun', start: '09:00', end: '18:00' }))
  );
  const [hoursNotes, setHoursNotes] = useState('');

  const grouped = useMemo(() => {
    const map = new Map<string, KnowledgeRow[]>();
    for (const it of items) {
      const key = it.category || 'other';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    // sort by created_at desc inside each group
    for (const [k, arr] of map.entries()) {
      map.set(
        k,
        [...arr].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      );
    }
    return map;
  }, [items]);

  // When switching to hours, set default title + content preview
  useEffect(() => {
    if (category === 'hours') {
      if (!title.trim()) setTitle('Business Hours');
      const generated = buildHoursContent(hoursRows, hoursNotes);
      setContent(generated);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  // Keep content in sync while editing hours (but only for hours category)
  useEffect(() => {
    if (category !== 'hours') return;
    setContent(buildHoursContent(hoursRows, hoursNotes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoursRows, hoursNotes]);

  async function loadAll() {
    setLoading(true);
    setError(null);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      router.push('/login');
      return;
    }

    const { data: ru, error: ruErr } = await supabase
      .from('restaurant_users')
      .select('restaurant_id')
      .eq('user_id', auth.user.id)
      .maybeSingle();

    if (ruErr) {
      setError(ruErr.message);
      setLoading(false);
      return;
    }

    if (!ru?.restaurant_id) {
      router.push('/restaurante/configurar');
      return;
    }

    setRestaurantId(ru.restaurant_id);

    const { data: company } = await supabase
      .from('restaurants')
      .select('name, industry')
      .eq('id', ru.restaurant_id)
      .single();

    if (company?.name) setCompanyName(company.name);
    if (company?.industry) setIndustry(company.industry as IndustryKey);

    const { data, error: e } = await supabase
      .from('company_knowledge')
      .select('id, restaurant_id, category, title, content, is_active, created_at')
      .eq('restaurant_id', ru.restaurant_id)
      .order('created_at', { ascending: false });

    if (e) {
      setError(e.message);
      setLoading(false);
      return;
    }

    setItems((data as KnowledgeRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- NEW: upsert behavior for hours ---
  async function upsertHours(finalContent: string) {
    if (!restaurantId) return { error: { message: 'Missing restaurantId' } as any };

    // Find existing hours rows for this restaurant
    const existingHours = items.filter((it) => it.category === 'hours' && it.restaurant_id === restaurantId);
    const current = pickMostRecent(existingHours);

    // If exists -> UPDATE it. Else -> INSERT
    if (current?.id) {
      const { error: e } = await supabase
        .from('company_knowledge')
        .update({
          title: (title.trim() || 'Business Hours') as any,
          content: finalContent,
          is_active: true,
        })
        .eq('id', current.id);

      return { error: e };
    }

    const { error: e } = await supabase.from('company_knowledge').insert({
      restaurant_id: restaurantId,
      category: 'hours',
      title: title.trim() || 'Business Hours',
      content: finalContent,
      is_active: true,
    });

    return { error: e };
  }

  async function saveIndustry(nextIndustry: IndustryKey) {
    if (!restaurantId) return;

    setSavingIndustry(true);
    setMsg(null);

    const previousIndustry = industry;
    setIndustry(nextIndustry);

    const { error: e } = await supabase
      .from('restaurants')
      .update({ industry: nextIndustry })
      .eq('id', restaurantId);

    setSavingIndustry(false);

    if (e) {
      setIndustry(previousIndustry);
      setMsg(`Failed to save industry: ${e.message}`);
      return;
    }

    setMsg(`Industry saved: ${industryLabel(nextIndustry)} ✅`);
    setTimeout(() => setMsg(null), 2000);
  }

  async function createItem() {
    if (!restaurantId) return;
    setCreating(true);
    setMsg(null);

    const finalContent = category === 'hours' ? buildHoursContent(hoursRows, hoursNotes) : content.trim();

    if (!finalContent.trim()) {
      setMsg('Content is required.');
      setCreating(false);
      return;
    }

    // extra guard: if hours, require at least one open day
    if (category === 'hours') {
      const anyOpen = hoursRows.some((r) => r.open);
      if (!anyOpen) {
        setMsg('Please set at least one open day.');
        setCreating(false);
        return;
      }
    }

    // ✅ KEY FIX: hours updates existing row instead of always inserting
    if (category === 'hours') {
      const { error: e } = await upsertHours(finalContent);
      setCreating(false);

      if (e) {
        setMsg(`Failed to save hours: ${e.message}`);
        return;
      }

      // Reset UI
      setTitle('');
      setContent('');
      setHoursNotes('');
      setHoursRows(DAYS.map((d) => ({ day: d.key, open: d.key !== 'sun', start: '09:00', end: '18:00' })));

      setMsg('Hours updated ✅');
      await loadAll();
      setTimeout(() => setMsg(null), 2000);
      return;
    }

    // Default behavior for other categories: INSERT new item
    const { error: e } = await supabase.from('company_knowledge').insert({
      restaurant_id: restaurantId,
      category,
      title: title.trim() || null,
      content: finalContent,
      is_active: true,
    });

    setCreating(false);

    if (e) {
      setMsg(`Failed to create: ${e.message}`);
      return;
    }

    setTitle('');
    setContent('');
    setHoursNotes('');
    setHoursRows(DAYS.map((d) => ({ day: d.key, open: d.key !== 'sun', start: '09:00', end: '18:00' })));

    setMsg('Saved ✅');
    await loadAll();
    setTimeout(() => setMsg(null), 2000);
  }

  async function toggleActive(item: KnowledgeRow) {
    const { error: e } = await supabase
      .from('company_knowledge')
      .update({ is_active: !item.is_active })
      .eq('id', item.id);

    if (e) {
      alert(`Error: ${e.message}`);
      return;
    }

    await loadAll();
  }

  async function quickEdit(item: KnowledgeRow) {
    const newContent = window.prompt('Edit content:', item.content);
    if (newContent === null) return;

    const newTitle = window.prompt('Edit title (optional):', item.title ?? '') ?? '';

    const { error: e } = await supabase
      .from('company_knowledge')
      .update({ content: newContent, title: newTitle.trim() || null })
      .eq('id', item.id);

    if (e) {
      alert(`Error: ${e.message}`);
      return;
    }

    await loadAll();
  }

  function setDayOpen(day: DayKey, open: boolean) {
    setHoursRows((prev) => prev.map((r) => (r.day === day ? { ...r, open } : r)));
  }
  function setDayStart(day: DayKey, start: string) {
    setHoursRows((prev) => prev.map((r) => (r.day === day ? { ...r, start } : r)));
  }
  function setDayEnd(day: DayKey, end: string) {
    setHoursRows((prev) => prev.map((r) => (r.day === day ? { ...r, end } : r)));
  }

  function applyWeekTemplate(start: string, end: string) {
    setHoursRows((prev) =>
      prev.map((r) => {
        const isWeekend = r.day === 'sat' || r.day === 'sun';
        if (isWeekend) return { ...r };
        return { ...r, open: true, start, end };
      })
    );
  }

  if (loading) return <main className="min-h-screen p-6">Loading...</main>;

  if (error) {
    return (
      <main className="min-h-screen p-6">
        <p className="text-red-600">Error: {error}</p>
      </main>
    );
  }

  const isHours = category === 'hours';

  return (
    <main className="min-h-screen p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Company Info</h1>
          <p className="text-sm text-gray-600">
            Company: <span className="font-semibold">{companyName}</span>
          </p>
          <p className="text-xs text-gray-500">
            This feeds the voice AI. The more accurate you are, the better it will perform.
          </p>
        </div>

        <button
          onClick={() => router.push('/leads')}
          className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800"
        >
          Back to Leads
        </button>
      </div>

      {/* Industry selector */}
      <div className="p-4 rounded-xl border shadow-sm space-y-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-bold">Business Industry</h2>
            <p className="text-sm text-gray-600">
              This controls how the voice AI behaves, what questions it asks, and how it qualifies leads.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Current industry: <span className="font-semibold">{industryLabel(industry)}</span>
            </p>
          </div>

          {savingIndustry && <p className="text-sm text-gray-500">Saving...</p>}
        </div>

        <label className="space-y-1 block max-w-xl">
          <div className="text-sm font-semibold">Select industry</div>
          <select
            className="w-full border rounded-lg p-2"
            value={industry}
            disabled={savingIndustry}
            onChange={(e) => setIndustry(e.target.value as IndustryKey)}
          >
            {INDUSTRY_OPTIONS.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => saveIndustry(industry)}
          disabled={savingIndustry}
          className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {savingIndustry ? 'Saving...' : 'Save Industry'}
        </button>

        <div className="grid gap-2 md:grid-cols-2">
          {INDUSTRY_OPTIONS.map((x) => (
            <div
              key={x.key}
              className={`p-3 rounded-lg border text-sm ${
                industry === x.key ? 'bg-purple-50 border-purple-200' : 'bg-white'
              }`}
            >
              <div className="font-semibold">{x.label}</div>
              <div className="text-gray-600 mt-1">{x.description}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Create new block */}
      <div className="p-4 rounded-xl border shadow-sm space-y-3">
        <h2 className="text-lg font-bold">Add information</h2>

        <div className="grid md:grid-cols-3 gap-3">
          <label className="space-y-1">
            <div className="text-sm font-semibold">Category</div>
            <select
              className="w-full border rounded-lg p-2"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORY_PRESETS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
              <option value="other">Other</option>
            </select>
          </label>

          <label className="space-y-1 md:col-span-2">
            <div className="text-sm font-semibold">Title (optional)</div>
            <input
              className="w-full border rounded-lg p-2"
              placeholder="Example: Roof leak repair, Shingle replacement, Flat roof..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        </div>

        {/* ✅ HOURS BUILDER */}
        {isHours ? (
          <div className="space-y-3">
            <div className="p-3 rounded-lg border bg-white">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold">Business hours builder</div>
                  <div className="text-xs text-gray-600">
                    Tip: keep this consistent with your team availability. The AI will read this exactly.
                  </div>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => applyWeekTemplate('09:00', '18:00')}
                    className="px-3 py-2 rounded-lg border hover:bg-gray-50 text-sm"
                  >
                    Apply Mon–Fri 09:00–18:00
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setHoursRows(DAYS.map((d) => ({ day: d.key, open: false, start: '09:00', end: '18:00' })))
                    }
                    className="px-3 py-2 rounded-lg border hover:bg-gray-50 text-sm"
                  >
                    Set all closed
                  </button>
                </div>
              </div>

              <div className="mt-3 grid gap-2">
                {DAYS.map((d) => {
                  const r = hoursRows.find((x) => x.day === d.key)!;
                  return (
                    <div key={d.key} className="grid grid-cols-12 gap-2 items-center p-2 rounded-lg border">
                      <div className="col-span-12 sm:col-span-2 font-semibold">{d.label}</div>

                      <div className="col-span-12 sm:col-span-3">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={r.open}
                            onChange={(e) => setDayOpen(d.key, e.target.checked)}
                          />
                          Open
                        </label>
                      </div>

                      <div className="col-span-6 sm:col-span-3">
                        <div className="text-xs text-gray-600 mb-1">Start</div>
                        <input
                          type="time"
                          className="w-full border rounded-lg p-2"
                          value={r.start}
                          disabled={!r.open}
                          onChange={(e) => setDayStart(d.key, e.target.value)}
                        />
                      </div>

                      <div className="col-span-6 sm:col-span-3">
                        <div className="text-xs text-gray-600 mb-1">End</div>
                        <input
                          type="time"
                          className="w-full border rounded-lg p-2"
                          value={r.end}
                          disabled={!r.open}
                          onChange={(e) => setDayEnd(d.key, e.target.value)}
                        />
                      </div>

                      <div className="col-span-12 sm:col-span-1 text-xs text-gray-500">{r.open ? '—' : 'Closed'}</div>
                    </div>
                  );
                })}
              </div>

              <label className="space-y-1 mt-3 block">
                <div className="text-sm font-semibold">Notes (optional)</div>
                <input
                  className="w-full border rounded-lg p-2"
                  placeholder="Example: Closed on major holidays. Saturday by appointment only."
                  value={hoursNotes}
                  onChange={(e) => setHoursNotes(e.target.value)}
                />
              </label>

              <div className="mt-3">
                <div className="text-sm font-semibold">Preview (what the AI will read)</div>
                <pre className="mt-1 whitespace-pre-wrap text-sm p-3 rounded-lg border bg-gray-50">
                  {buildHoursContent(hoursRows, hoursNotes) || '—'}
                </pre>
              </div>
            </div>

            {/* Keep textarea too (read-only) so user can see exact saved text */}
            <label className="space-y-1">
              <div className="text-sm font-semibold">Content (auto-generated)</div>
              <textarea className="w-full border rounded-lg p-3 min-h-[130px] bg-gray-50" value={content} readOnly />
            </label>
          </div>
        ) : (
          <label className="space-y-1">
            <div className="text-sm font-semibold">Content</div>
            <textarea
              className="w-full border rounded-lg p-3 min-h-[130px]"
              placeholder="Write the exact information the AI is allowed to tell customers..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </label>
        )}

        <div className="flex items-center justify-between">
          <button
            onClick={createItem}
            disabled={creating}
            className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {creating ? 'Saving...' : isHours ? 'Save / Update Hours' : 'Save'}
          </button>

          {msg && (
            <p className={msg.startsWith('Failed') ? 'text-red-600 text-sm' : 'text-green-700 text-sm'}>{msg}</p>
          )}
        </div>
      </div>

      {/* List by category */}
      {[...grouped.entries()].length === 0 ? (
        <div className="p-4 rounded-xl border">
          <p className="font-semibold">No information yet.</p>
          <p className="text-sm text-gray-600">Start with “Services”, “Service Areas”, and “Business Hours”.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {[...grouped.entries()].map(([cat, arr]) => {
            const label = CATEGORY_PRESETS.find((c) => c.key === cat)?.label ?? cat;

            return (
              <div key={cat} className="p-4 rounded-xl border shadow-sm space-y-3">
                <h3 className="text-lg font-bold">{label}</h3>

                <div className="space-y-2">
                  {arr.map((it) => (
                    <div key={it.id} className="p-3 rounded-lg border bg-white">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold">
                            {it.title ?? 'Untitled'} {!it.is_active && <span className="text-xs text-gray-500">(inactive)</span>}
                          </div>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap mt-1">{it.content}</p>
                        </div>

                        <div className="flex gap-2 shrink-0">
                          <button onClick={() => quickEdit(it)} className="px-3 py-2 rounded-lg border hover:bg-gray-50">
                            Edit
                          </button>
                          <button onClick={() => toggleActive(it)} className="px-3 py-2 rounded-lg border hover:bg-gray-50">
                            {it.is_active ? 'Disable' : 'Enable'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}