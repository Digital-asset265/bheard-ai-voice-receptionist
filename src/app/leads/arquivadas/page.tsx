'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type Lead = {
  id: string;
  full_name: string | null;
  phone: string;
  problem_type: string | null;
  urgency: 'immediate' | '24h' | 'flexible';
  severity: 'low' | 'medium' | 'high';
  status: 'resolved';
  created_at: string;
  summary: string | null;
};

export default function ArchivedLeadsPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState<string>('—');
  const [restaurantId, setRestaurantId] = useState<string | null>(null);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;

      if (!user) {
        router.push('/login');
        return;
      }

      const { data: ru, error: ruErr } = await supabase
        .from('restaurant_users')
        .select('restaurant_id')
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

      const { data: company, error: compErr } = await supabase
        .from('restaurants')
        .select('name')
        .eq('id', ru.restaurant_id)
        .single();

      if (!compErr && company?.name) setCompanyName(company.name);

      const { data: leadsData, error: leadsErr } = await supabase
        .from('leads')
        .select('id, full_name, phone, problem_type, urgency, severity, status, created_at, summary')
        .eq('restaurant_id', ru.restaurant_id)
        .eq('status', 'resolved')
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

  if (loading) return <main className="min-h-screen p-6">Loading archived leads...</main>;

  if (error) {
    return (
      <main className="min-h-screen p-6">
        <p className="text-red-600">Error: {error}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Archived leads (Resolved)</h1>
          <p className="text-sm text-gray-600">
            Company: <span className="font-semibold">{companyName}</span>
          </p>
          {restaurantId && (
            <p className="text-xs text-gray-400">
              (Internal ID: <span className="font-mono">{restaurantId}</span>)
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => router.push('/leads')}
            className="px-4 py-2 rounded-lg border hover:bg-gray-50"
          >
            Back to dashboard
          </button>
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="p-4 rounded-lg border">
          <p className="font-semibold">No archived leads yet.</p>
          <p className="text-sm text-gray-600">When a lead is marked as resolved, it will appear here.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {leads.map((lead) => (
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
                    {lead.problem_type ?? 'No issue type'} • <b>resolved</b>
                  </div>

                  {lead.summary ? (
                    <p className="text-sm text-gray-700 mt-2 line-clamp-2">{lead.summary}</p>
                  ) : (
                    <p className="text-sm text-gray-500 mt-2 italic">No summary.</p>
                  )}
                </div>

                <div className="text-sm shrink-0 text-right">
                  <div>
                    Urgency: <b>{lead.urgency}</b>
                  </div>
                  <div>
                    Severity: <b>{lead.severity}</b>
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    {new Date(lead.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
