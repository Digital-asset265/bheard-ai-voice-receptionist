'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type Lead = {
  id: string;
  full_name: string | null;
  phone: string;
  problem_type: string | null;
  urgency: 'immediate' | '24h' | 'flexible';
  severity: 'low' | 'medium' | 'high';
  status: 'new' | 'contacted' | 'scheduled' | 'resolved' | 'lost';
  created_at: string;
  summary: string | null;
};

type Membership = {
  restaurant_id: string;
  role: 'owner' | 'staff' | string | null;
};

function urgencyRank(u: Lead['urgency']) {
  if (u === 'immediate') return 0;
  if (u === '24h') return 1;
  return 2;
}

function severityRank(s: Lead['severity']) {
  if (s === 'high') return 0;
  if (s === 'medium') return 1;
  return 2;
}

function statusRank(st: Lead['status']) {
  // ordem “operacional”: novos primeiro, depois em andamento, depois concluídos/perdidos
  if (st === 'new') return 0;
  if (st === 'contacted') return 1;
  if (st === 'scheduled') return 2;
  if (st === 'resolved') return 3;
  return 4; // lost
}

export default function LeadsPage() {
  const router = useRouter();

  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>('—');
  const [membership, setMembership] = useState<Membership | null>(null);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ✅ menu mobile
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const isOwner = membership?.role === 'owner';

  // ✅ Staff sem autorização total: só New Lead + Archived
  // (por agora “autorização total” = role owner)
  const canManageSettings = isOwner;

  // ✅ Safety net no front: garante que "resolved" não aparece no dashboard
  const activeLeads = useMemo(() => leads.filter((l) => l.status !== 'resolved'), [leads]);

  // ✅ lista principal: leads ATIVAS, ordenadas por prioridade
  const prioritizedLeads = useMemo(() => {
    const copy = [...activeLeads];
    copy.sort((a, b) => {
      // 1) status (novas primeiro)
      const st = statusRank(a.status) - statusRank(b.status);
      if (st !== 0) return st;

      // 2) severity (high primeiro)
      const sv = severityRank(a.severity) - severityRank(b.severity);
      if (sv !== 0) return sv;

      // 3) urgency (immediate primeiro)
      const ur = urgencyRank(a.urgency) - urgencyRank(b.urgency);
      if (ur !== 0) return ur;

      // 4) created_at (mais recente primeiro)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return copy;
  }, [activeLeads]);

  // ✅ secções “rápidas” (atalhos) — também só com leads ATIVAS
  const { urgentNew, scheduled } = useMemo(() => {
    const urgentNewLeads = activeLeads
      .filter((l) => l.status === 'new' && (l.urgency === 'immediate' || l.urgency === '24h'))
      .sort((a, b) => {
        const sv = severityRank(a.severity) - severityRank(b.severity);
        if (sv !== 0) return sv;

        const u = urgencyRank(a.urgency) - urgencyRank(b.urgency);
        if (u !== 0) return u;

        return new Date(b.created_at).getTime() - new Date(b.created_at).getTime();
      });

    const scheduledLeads = activeLeads
      .filter((l) => l.status === 'scheduled')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return { urgentNew: urgentNewLeads, scheduled: scheduledLeads };
  }, [activeLeads]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) {
        setError(authErr.message);
        setLoading(false);
        return;
      }

      const user = auth?.user;
      if (!user) {
        router.push('/login');
        return;
      }

      // 1) restaurant_id + role (✅ só colunas que existem)
      const { data: ru, error: ruErr } = await supabase
        .from('restaurant_users')
        .select('restaurant_id, role')
        .eq('user_id', user.id)
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
      setMembership({
        restaurant_id: ru.restaurant_id,
        role: (ru.role ?? null) as any,
      });

      // 2) company name
      const { data: company, error: compErr } = await supabase
        .from('restaurants')
        .select('name')
        .eq('id', ru.restaurant_id)
        .single();

      if (!compErr && company?.name) setCompanyName(company.name);

      // 3) leads (✅ puxa só as ATIVAS: exclui resolved)
      const { data: leadsData, error: leadsErr } = await supabase
        .from('leads')
        .select('id, full_name, phone, problem_type, urgency, severity, status, created_at, summary')
        .eq('restaurant_id', ru.restaurant_id)
        .neq('status', 'resolved')
        .order('created_at', { ascending: false });

      if (leadsErr) {
        setError(leadsErr.message);
        setLoading(false);
        return;
      }

      setLeads((leadsData as Lead[]) ?? []);
      setLoading(false);
    })();
  }, [router]);

  // ✅ fecha menu mobile ao mudar de “empresa” (defensivo)
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [restaurantId]);

  async function handleSignOut() {
    try {
      setSigningOut(true);
      setError(null);
      await supabase.auth.signOut();
      router.push('/login');
    } catch (e: any) {
      console.error(e);
      setError('Erro ao terminar sessão.');
    } finally {
      setSigningOut(false);
      setMobileMenuOpen(false);
    }
  }

  function NavButton({
    label,
    onClick,
    variant = 'outline',
  }: {
    label: string;
    onClick: () => void;
    variant?: 'outline' | 'primary' | 'danger';
  }) {
    const base = 'w-full sm:w-auto px-4 py-2 rounded-lg text-sm font-medium transition';
    const styles =
      variant === 'primary'
        ? 'bg-purple-600 text-white hover:bg-purple-700'
        : variant === 'danger'
          ? 'border border-red-200 text-red-700 hover:bg-red-50'
          : 'border hover:bg-gray-50';

    return (
      <button type="button" onClick={onClick} className={`${base} ${styles}`}>
        {label}
      </button>
    );
  }

  function LeadCard({ lead }: { lead: Lead }) {
    return (
      <button
        key={lead.id}
        onClick={() => router.push(`/leads/ver?id=${lead.id}`)}
        className="w-full text-left p-4 rounded-xl border hover:bg-gray-50 shadow-sm"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-semibold text-lg truncate">
              {lead.full_name ?? 'No name'} — {lead.phone}
            </div>

            <div className="text-sm text-gray-600">
              {lead.problem_type ?? 'No issue type'} • <b>{lead.status}</b>
            </div>

            {lead.summary ? (
              <p className="text-sm text-gray-700 mt-2 line-clamp-2">{lead.summary}</p>
            ) : (
              <p className="text-sm text-gray-500 mt-2 italic">No summary yet.</p>
            )}
          </div>

          <div className="text-sm shrink-0 text-right">
            <div>
              Urgency: <b>{lead.urgency}</b>
            </div>
            <div>
              Severity: <b>{lead.severity}</b>
            </div>
            <div className="text-xs text-gray-500 mt-2">{new Date(lead.created_at).toLocaleString()}</div>
          </div>
        </div>
      </button>
    );
  }

  if (loading) {
    return <main className="min-h-screen p-6">Loading leads...</main>;
  }

  if (error) {
    return (
      <main className="min-h-screen p-6">
        <p className="text-red-600">Error: {error}</p>
      </main>
    );
  }

  const hasAny = prioritizedLeads.length > 0;

  return (
    <main className="min-h-screen p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Leads Dashboard</h1>
          <p className="text-sm text-gray-600">
            Company: <span className="font-semibold">{companyName}</span>
          </p>

          <div className="text-xs text-gray-500 mt-1">
            Access: <span className="font-semibold">{isOwner ? 'Owner' : 'Staff'}</span>
          </div>

          {restaurantId && (
            <p className="text-xs text-gray-400">
              (Internal ID: <span className="font-mono">{restaurantId}</span>)
            </p>
          )}
        </div>

        {/* ✅ Desktop/Tablet actions */}
        <div className="desktop-actions hidden sm:flex items-center gap-2 flex-wrap justify-start">
          <NavButton label="Archived (Resolved)" onClick={() => router.push('/leads/arquivadas')} />

          {canManageSettings && (
            <>
              <NavButton label="Company Info" onClick={() => router.push('/empresa/info')} />
              <NavButton label="Invite Member" onClick={() => router.push('/invites/new')} />
            </>
          )}

          <NavButton label="+ New Lead" variant="primary" onClick={() => router.push('/leads/novo')} />

          <NavButton
            label={signingOut ? 'Signing out...' : 'Sign out'}
            variant="danger"
            onClick={handleSignOut}
          />
        </div>

        {/* ✅ Mobile menu (sanduíche) — CSS força em telemóvel */}
        <div className="mobile-actions relative">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="inline-flex items-center justify-center rounded-lg border px-3 py-2 hover:bg-gray-50"
            aria-label="Open menu"
          >
            <span className="text-lg">☰</span>
          </button>

          {mobileMenuOpen && (
            <div className="absolute right-0 mt-2 w-64 rounded-xl border bg-white shadow-lg z-50">
              <div className="px-3 py-2 text-xs text-gray-500 border-b">Menu</div>

              <div className="p-2 space-y-2 max-h-[70vh] overflow-y-auto">
                <NavButton label="+ New Lead" variant="primary" onClick={() => router.push('/leads/novo')} />
                <NavButton label="Archived (Resolved)" onClick={() => router.push('/leads/arquivadas')} />

                {canManageSettings && (
                  <>
                    <NavButton label="Company Info" onClick={() => router.push('/empresa/info')} />
                    <NavButton label="Invite Member" onClick={() => router.push('/invites/new')} />
                  </>
                )}

                <div className="pt-1 border-t" />

                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="w-full px-4 py-2 rounded-lg text-sm font-medium border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  {signingOut ? 'Signing out...' : 'Sign out'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ✅ Mantido (original) — mantido no ficheiro, mas DESATIVADO para evitar 2 menus */}
        {false && (
          <div className="legacy-mobile-menu sm:hidden relative">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="inline-flex items-center justify-center rounded-lg border px-3 py-2 hover:bg-gray-50"
              aria-label="Open menu"
            >
              <span className="text-lg">☰</span>
            </button>

            {mobileMenuOpen && (
              <div className="absolute right-0 mt-2 w-64 rounded-xl border bg-white shadow-lg z-30 overflow-hidden">
                <div className="px-3 py-2 text-xs text-gray-500 border-b">Menu</div>

                <div className="p-2 space-y-2">
                  <NavButton label="+ New Lead" variant="primary" onClick={() => router.push('/leads/novo')} />
                  <NavButton label="Archived (Resolved)" onClick={() => router.push('/leads/arquivadas')} />

                  {canManageSettings && (
                    <>
                      <NavButton label="Company Info" onClick={() => router.push('/empresa/info')} />
                      <NavButton label="Invite Member" onClick={() => router.push('/invites/new')} />
                    </>
                  )}

                  <div className="pt-1 border-t" />

                  <NavButton
                    label={signingOut ? 'Signing out...' : 'Sign out'}
                    variant="danger"
                    onClick={handleSignOut}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {!hasAny ? (
        <div className="p-4 rounded-lg border">
          <p className="font-semibold">No leads yet.</p>
          <p className="text-sm text-gray-600">You can create a manual lead to test the workflow.</p>
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">All Leads (Prioritized)</h2>
              <p className="text-sm text-gray-600">{prioritizedLeads.length} lead(s)</p>
            </div>

            <div className="grid gap-3">
              {prioritizedLeads.map((lead) => (
                <LeadCard key={lead.id} lead={lead} />
              ))}
            </div>
          </section>

          <section className="space-y-3 pt-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">New / Urgent (Shortcut)</h2>
              <p className="text-sm text-gray-600">{urgentNew.length} lead(s)</p>
            </div>

            {urgentNew.length === 0 ? (
              <div className="p-4 rounded-lg border text-sm text-gray-600">No urgent new leads right now.</div>
            ) : (
              <div className="grid gap-3">
                {urgentNew.map((lead) => (
                  <LeadCard key={lead.id} lead={lead} />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Scheduled (Shortcut)</h2>
              <p className="text-sm text-gray-600">{scheduled.length} lead(s)</p>
            </div>

            {scheduled.length === 0 ? (
              <div className="p-4 rounded-lg border text-sm text-gray-600">No scheduled leads yet.</div>
            ) : (
              <div className="grid gap-3">
                {scheduled.map((lead) => (
                  <LeadCard key={lead.id} lead={lead} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}