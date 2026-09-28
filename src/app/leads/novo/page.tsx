'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function NovoLeadPage() {
  const router = useRouter();

  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [problemType, setProblemType] = useState('');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high'>('medium');
  const [urgency, setUrgency] = useState<'immediate' | '24h' | 'flexible'>('flexible');
  const [summary, setSummary] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) {
        setError(authErr.message);
        return;
      }

      const user = auth?.user;
      if (!user) {
        router.push('/login');
        return;
      }

      setUserId(user.id);

      const { data: ru, error: ruErr } = await supabase
        .from('restaurant_users')
        .select('restaurant_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (ruErr) {
        setError(ruErr.message);
        return;
      }

      if (!ru?.restaurant_id) {
        router.push('/restaurante/configurar');
        return;
      }

      setRestaurantId(ru.restaurant_id);
    })();
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    // fallback (caso raro em que userId ainda não foi preenchido)
    let uid = userId;
    if (!uid) {
      const { data: auth } = await supabase.auth.getUser();
      uid = auth?.user?.id ?? null;
      setUserId(uid);
    }

    if (!uid) {
      setError('Sessão inválida. Faz login novamente.');
      setSaving(false);
      router.push('/login');
      return;
    }

    if (!restaurantId) {
      setError('Empresa não encontrada.');
      setSaving(false);
      return;
    }

    if (!phone.trim()) {
      setError('Telefone é obrigatório.');
      setSaving(false);
      return;
    }

    const { data, error: insErr } = await supabase
      .from('leads')
      .insert({
        restaurant_id: restaurantId,
        full_name: fullName.trim() || null,
        phone: phone.trim(),
        email: email.trim() || null,
        address: address.trim() || null,
        problem_type: problemType.trim() || null,
        severity,
        urgency,
        summary: summary.trim() || null,
        source: 'manual',
        status: 'new',
        created_by: uid, // ✅ para excluir quem criou
      })
      .select('id')
      .single();

    if (insErr) {
      setError(insErr.message);
      setSaving(false);
      return;
    }

    // ✅ chama via API route (server-side) — sem JWT do user
    try {
      const res = await fetch('/api/notify-new-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: data.id }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        console.warn('notify-new-lead falhou:', res.status, txt);
      } else {
        // opcional: ver resposta
        // console.log('notify-new-lead ok:', await res.text());
      }
    } catch (err) {
      console.warn('notify-new-lead falhou (network):', err);
    }

    router.push(`/leads/ver?id=${data.id}`);
  }

  return (
    <main className="min-h-screen p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Novo lead</h1>
        <button className="text-sm underline" onClick={() => router.push('/leads')}>
          Voltar
        </button>
      </div>

      {error && <p className="text-red-600">Erro: {error}</p>}

      <form onSubmit={onSubmit} className="space-y-3 max-w-xl">
        <input
          className="w-full border rounded-lg p-2"
          placeholder="Nome do cliente"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />

        <input
          className="w-full border rounded-lg p-2"
          placeholder="Telefone *"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />

        <input
          className="w-full border rounded-lg p-2"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          className="w-full border rounded-lg p-2"
          placeholder="Morada"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />

        <input
          className="w-full border rounded-lg p-2"
          placeholder="Tipo de problema (ex: infiltração)"
          value={problemType}
          onChange={(e) => setProblemType(e.target.value)}
        />

        <div className="flex gap-3">
          <label className="flex-1">
            <div className="text-sm mb-1">Gravidade</div>
            <select
              className="w-full border rounded-lg p-2"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as any)}
            >
              <option value="low">Baixa</option>
              <option value="medium">Média</option>
              <option value="high">Alta</option>
            </select>
          </label>

          <label className="flex-1">
            <div className="text-sm mb-1">Urgência</div>
            <select
              className="w-full border rounded-lg p-2"
              value={urgency}
              onChange={(e) => setUrgency(e.target.value as any)}
            >
              <option value="immediate">Imediata</option>
              <option value="24h">24h</option>
              <option value="flexible">Flexível</option>
            </select>
          </label>
        </div>

        <textarea
          className="w-full border rounded-lg p-2"
          rows={4}
          placeholder="Resumo (o que aconteceu, o que o cliente quer)"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />

        <button
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {saving ? 'A guardar...' : 'Criar lead'}
        </button>
      </form>
    </main>
  );
}
