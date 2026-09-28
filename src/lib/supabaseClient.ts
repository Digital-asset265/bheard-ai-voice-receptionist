import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase URL or Anon Key missing. Check .env.local')
}

// ✅ Storage compatível com Supabase
const capacitorStorage = {
  async getItem(key: string) {
    const { value } = await Preferences.get({ key })
    return value
  },
  async setItem(key: string, value: string) {
    await Preferences.set({ key, value })
  },
  async removeItem(key: string) {
    await Preferences.remove({ key })
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: Capacitor.isNativePlatform() ? capacitorStorage : undefined,
  },
})
