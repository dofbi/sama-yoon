// Supabase backend (Postgres + Realtime). Loaded with a dynamic import only
// when VITE_SUPABASE_URL is set, so the demo build ships without the SDK.
// Schema, RLS and the increment_upvote RPC live in supabase/schema.sql.
import { createClient } from '@supabase/supabase-js';

const COLUMNS = 'id, created_at, latitude, longitude, report_type, description, upvotes, expires_at';

export function createSupabaseStore(url, anonKey) {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });

  return {
    mode: 'supabase',
    async list() {
      const { data, error } = await client
        .from('user_reports')
        .select(COLUMNS)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
    async create({ latitude, longitude, report_type, description = null }) {
      const { data, error } = await client
        .from('user_reports')
        .insert({ latitude, longitude, report_type, description })
        .select(COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    async upvote(id) {
      const { data, error } = await client.rpc('increment_upvote', { report_id: id });
      if (error) throw error;
      return data;
    },
    subscribe(cb) {
      const ch = client
        .channel('user_reports_feed')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_reports' }, (p) => cb({ type: 'insert', report: p.new }))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_reports' }, (p) => cb({ type: 'update', report: p.new }))
        .subscribe();
      return () => client.removeChannel(ch);
    },
  };
}
