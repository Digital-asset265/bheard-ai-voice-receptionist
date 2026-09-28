'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type LeadStatus = 'new' | 'contacted' | 'scheduled' | 'resolved' | 'lost';
type LeadUrgency = 'immediate' | '24h' | 'flexible';
type LeadSeverity = 'low' | 'medium' | 'high';

type Lead = {
  id: string;
  restaurant_id: string;
  full_name: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  problem_type: string | null;
  severity: LeadSeverity | string;
  urgency: LeadUrgency | string;
  summary: string | null;
  status: LeadStatus | string;
  internal_notes: string | null;
  created_at: string;
};

type FollowUp = {
  id: string;
  lead_id: string;
  restaurant_id: string;
  type: 'call' | 'visit';
  scheduled_for: string | null;
  notes: string | null;
  status: 'pending' | 'done' | 'cancelled';
  created_at: string;
};

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'resolved', label: 'Resolved (Completed)' },
  { value: 'lost', label: 'Lost' },
];

export default function LeadViewClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const leadId = searchParams.get('id');

  const [lead, setLead] = useState<Lead | null>(null);
  const [followups, setFollowups] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Internal notes
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Status controls
  const [statusDraft, setStatusDraft] = useState<LeadStatus>('new');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Delete lead
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  // Create follow-up
  const [fuType, setFuType] = useState<'call' | 'visit'>('call');
  const [fuWhen, setFuWhen] = useState(''); // datetime-local string
  const [fuNotes, setFuNotes] = useState('');
  const [creatingFU, setCreatingFU] = useState(false);
  const [fuMsg, setFuMsg] = useState<string | null>(null);

  const formattedCreatedAt = useMemo(() => {
    if (!lead?.created_at) return '';
    return new Date(lead.created_at).toLocaleString();
  }, [lead?.created_at]);

  async function loadAll() {
    setLoading(true);
    setError(null);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      router.push('/login');
      return;
    }

    if (!leadId) {
      setError('Missing lead ID in URL. Example: /leads/ver?id=...');
      setLoading(false);
      return;
    }

    const { data: leadData, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single();

    if (leadErr) {
      setError(leadErr.message);
      setLoading(false);
      return;
    }

    const l = leadData as Lead;
    setLead(l);
    setNotes(l.internal_notes ?? '');

    // status draft default
    const safeStatus = (STATUS_OPTIONS.find((o) => o.value === (l.status as any))?.value ??
      'new') as LeadStatus;
    setStatusDraft(safeStatus);

    const { data: fuData, error: fuErr } = await supabase
      .from('lead_followups')
      .select('id, lead_id, restaurant_id, type, scheduled_for, notes, status, created_at')
      .eq('lead_id', l.id)
      .order('created_at', { ascending: false });

    if (fuErr) {
      setError(fuErr.message);
      setLoading(false);
      return;
    }

    setFollowups((fuData as FollowUp[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function saveInternalNotes() {
    if (!lead) return;
    setSavingNotes(true);
    setSavedMsg(null);

    const { error: e } = await supabase
      .from('leads')
      .update({ internal_notes: notes })
      .eq('id', lead.id);

    setSavingNotes(false);

    if (e) {
      setSavedMsg(`Failed to save: ${e.message}`);
      return;
    }

    setSavedMsg('Saved ✅');
    setLead({ ...lead, internal_notes: notes });
    setTimeout(() => setSavedMsg(null), 2000);
  }

  async function updateLeadStatus(nextStatus: LeadStatus) {
    if (!lead) return;
    setUpdatingStatus(true);
    setStatusMsg(null);

    const { error: e } = await supabase
      .from('leads')
      .update({ status: nextStatus })
      .eq('id', lead.id);

    setUpdatingStatus(false);

    if (e) {
      setStatusMsg(`Failed to update status: ${e.message}`);
      return;
    }

    setStatusMsg('Status updated ✅');
    setLead({ ...lead, status: nextStatus });
    setTimeout(() => setStatusMsg(null), 2000);
  }

  async function onClickDeleteLead() {
    if (!lead) return;
    setDeleteMsg(null);

    const ok = window.confirm(
      'Delete this lead permanently?\n\nThis cannot be undone.'
    );
    if (!ok) return;

    setDeleting(true);

    // opcional: primeiro apagar followups (se não tiveres ON DELETE CASCADE)
    const { error: delFU } = await supabase.from('lead_followups').delete().eq('lead_id', lead.id);
    if (delFU) {
      setDeleting(false);
      setDeleteMsg(`Failed to delete follow-ups: ${delFU.message}`);
      return;
    }

    const { error: delLead } = await supabase.from('leads').delete().eq('id', lead.id);
    setDeleting(false);

    if (delLead) {
      setDeleteMsg(`Failed to delete lead: ${delLead.message}`);
      return;
    }

    // volta para dashboard
    router.push('/leads');
  }

  async function createFollowUp() {
    if (!lead) return;
    setCreatingFU(true);
    setFuMsg(null);

    const scheduledISO = fuWhen ? new Date(fuWhen).toISOString() : null;

    const { error: insErr } = await supabase.from('lead_followups').insert({
      restaurant_id: lead.restaurant_id,
      lead_id: lead.id,
      type: fuType,
      scheduled_for: scheduledISO,
      notes: fuNotes.trim() || null,
      status: 'pending',
    });

    if (insErr) {
      setCreatingFU(false);
      setFuMsg(`Failed to create follow-up: ${insErr.message}`);
      return;
    }

    // se criou follow-up, status => scheduled
    const { error: updErr } = await supabase
      .from('leads')
      .update({ status: 'scheduled' })
      .eq('id', lead.id);

    setCreatingFU(false);

    if (updErr) {
      setFuMsg(`Follow-up created, but failed to update status: ${updErr.message}`);
      await loadAll();
      return;
    }

    setFuMsg('Follow-up created ✅');
    setFuWhen('');
    setFuNotes('');
    await loadAll();
    setTimeout(() => setFuMsg(null), 2000);
  }

  if (loading) return <main className="min-h-screen p-6">Loading lead...</main>;
  if (error) return <main className="min-h-screen p-6 text-red-600">Error: {error}</main>;
  if (!lead) return <main className="min-h-screen p-6">Lead not found.</main>;

  return (
    <main className="min-h-screen p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Lead details</h1>
        <button className="text-sm underline" onClick={() => router.push('/leads')}>
          Back
        </button>
      </div>

      {/* LEAD CARD */}
      <div className="p-4 rounded-xl border shadow-sm space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-lg truncate">
              {lead.full_name ?? 'No name'} — {lead.phone}
            </div>
            <div className="text-xs text-gray-500 mt-1">Created: {formattedCreatedAt}</div>
          </div>

          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => updateLeadStatus('resolved')}
              disabled={updatingStatus}
              className="px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              title="Mark as completed"
            >
              {updatingStatus ? '...' : 'Mark done'}
            </button>

            <button
              onClick={onClickDeleteLead}
              disabled={deleting}
              className="px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              title="Delete lead"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>

        {/* STATUS EDITOR */}
        <div className="p-3 rounded-lg border bg-gray-50">
          <div className="flex flex-col md:flex-row md:items-end gap-3">
            <label className="flex-1">
              <div className="text-sm font-semibold">Status</div>
              <select
                className="w-full border rounded-lg p-2"
                value={statusDraft}
                onChange={(e) => setStatusDraft(e.target.value as LeadStatus)}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              onClick={() => updateLeadStatus(statusDraft)}
              disabled={updatingStatus}
              className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {updatingStatus ? 'Updating...' : 'Update status'}
            </button>
          </div>

          {statusMsg && (
            <p className={statusMsg.startsWith('Failed') ? 'text-red-600 text-sm mt-2' : 'text-green-700 text-sm mt-2'}>
              {statusMsg}
            </p>
          )}
          {deleteMsg && <p className="text-red-600 text-sm mt-2">{deleteMsg}</p>}
        </div>

        <div className="text-sm text-gray-700 grid md:grid-cols-2 gap-2">
          <div>
            <b>Current status:</b> {lead.status}
          </div>
          <div>
            <b>Urgency:</b> {lead.urgency}
          </div>
          <div>
            <b>Severity:</b> {lead.severity}
          </div>
          <div>
            <b>Issue type:</b> {lead.problem_type ?? '-'}
          </div>
          <div>
            <b>Email:</b> {lead.email ?? '-'}
          </div>
          <div>
            <b>Address:</b> {lead.address ?? '-'}
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold">Summary</div>
          <div className="text-sm text-gray-700 whitespace-pre-wrap">{lead.summary ?? '—'}</div>
        </div>

        <div className="flex gap-2 pt-2">
          <a
            className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700"
            href={`tel:${lead.phone}`}
          >
            Call now
          </a>
        </div>
      </div>

      {/* FOLLOW-UPS */}
      <div className="p-4 rounded-xl border shadow-sm space-y-3">
        <h2 className="text-lg font-bold">Follow-ups</h2>

        <div className="grid md:grid-cols-3 gap-3">
          <label className="space-y-1">
            <div className="text-sm font-semibold">Type</div>
            <select
              className="w-full border rounded-lg p-2"
              value={fuType}
              onChange={(e) => setFuType(e.target.value as any)}
            >
              <option value="call">Call</option>
              <option value="visit">Visit</option>
            </select>
          </label>

          <label className="space-y-1">
            <div className="text-sm font-semibold">When</div>
            <input
              className="w-full border rounded-lg p-2"
              type="datetime-local"
              value={fuWhen}
              onChange={(e) => setFuWhen(e.target.value)}
            />
          </label>

          <div className="flex items-end">
            <button
              onClick={createFollowUp}
              disabled={creatingFU}
              className="w-full px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {creatingFU ? 'Creating...' : 'Create follow-up'}
            </button>
          </div>
        </div>

        <textarea
          className="w-full border rounded-lg p-3"
          rows={3}
          placeholder="Follow-up notes (e.g., ask for photos, confirm address, etc.)"
          value={fuNotes}
          onChange={(e) => setFuNotes(e.target.value)}
        />

        {fuMsg && (
          <p
            className={
              fuMsg.startsWith('Failed') || fuMsg.startsWith('Follow-up created, but failed')
                ? 'text-red-600 text-sm'
                : 'text-green-700 text-sm'
            }
          >
            {fuMsg}
          </p>
        )}

        {followups.length === 0 ? (
          <p className="text-sm text-gray-600">No follow-ups yet.</p>
        ) : (
          <div className="space-y-2">
            {followups.map((f) => (
              <div key={f.id} className="p-3 rounded-lg border">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">
                    {f.type === 'call' ? '📞 Call' : '🏠 Visit'} • {f.status}
                  </div>
                  <div className="text-sm text-gray-600">
                    {f.scheduled_for ? new Date(f.scheduled_for).toLocaleString() : 'No date'}
                  </div>
                </div>
                {f.notes ? (
                  <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{f.notes}</p>
                ) : (
                  <p className="text-sm text-gray-500 mt-1 italic">No notes.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* INTERNAL NOTES */}
      <div className="p-4 rounded-xl border shadow-sm space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">Internal notes</h2>
          <button
            onClick={saveInternalNotes}
            disabled={savingNotes}
            className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {savingNotes ? 'Saving...' : 'Save notes'}
          </button>
        </div>

        <p className="text-sm text-gray-600">
          Add internal context for the owner/team (status, next steps, call notes, etc.).
        </p>

        <textarea
          className="w-full border rounded-lg p-3 min-h-[140px]"
          placeholder="Example: Leak in bedroom ceiling. Ask for photos via SMS. Schedule site visit tomorrow 10:00."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {savedMsg && (
          <p className={savedMsg.startsWith('Failed') ? 'text-red-600 text-sm' : 'text-green-700 text-sm'}>
            {savedMsg}
          </p>
        )}
      </div>
    </main>
  );
}
