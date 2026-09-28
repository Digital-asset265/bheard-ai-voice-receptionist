'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { initPushNotifications } from '@/lib/pushNotifications';

export default function ClientInit() {
  useEffect(() => {
    let unsub: any = null;

    const ONESIGNAL_APP_ID = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;

    const safe = async (fn: () => Promise<any>) => {
      try {
        await fn();
      } catch {
        // não rebenta a app se o OneSignal ainda não estiver carregado
      }
    };

    const linkOneSignalToUser = async (userId: string) => {
      const os: any = (globalThis as any).OneSignal;
      if (!os) return;

      // associa device ao user atual
      await safe(() => os.login(userId));

      // tags para targeting
      const { data: ru, error: ruErr } = await supabase
        .from('restaurant_users')
        .select('restaurant_id, role')
        .eq('user_id', userId)
        .maybeSingle();

      if (!ruErr && ru?.restaurant_id) {
        await safe(() => os.User?.addTag?.('restaurant_id', String(ru.restaurant_id)));
      }
      if (!ruErr && ru?.role) {
        await safe(() => os.User?.addTag?.('role', String(ru.role)));
      }

      await safe(() => os.Notifications?.requestPermission?.(true));
    };

    const run = async () => {
      // inicializa OneSignal + regista token (via RPC claim_push_token no pushNotifications.ts)
      initPushNotifications();

      if (!ONESIGNAL_APP_ID) return;

      // se já houver sessão, liga já
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      if (user?.id) await linkOneSignalToUser(user.id);

      // bind auth changes
      const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
        const os: any = (globalThis as any).OneSignal;

        if (event === 'SIGNED_OUT') {
          if (os) await safe(() => os.logout());
          return;
        }

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          const uid = session?.user?.id;
          if (uid) await linkOneSignalToUser(uid);
        }
      });

      unsub = listener?.subscription;
    };

    run();

    return () => {
      try {
        unsub?.unsubscribe?.();
      } catch {}
    };
  }, []);

  return null;
}