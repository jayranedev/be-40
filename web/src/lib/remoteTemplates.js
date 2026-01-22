import { supabase } from './supabase.js';

const TABLE = 'face_templates';

export async function saveRemoteTemplate({ wallet, payload }) {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }
  const { data, error } = await supabase
    .from(TABLE)
    .upsert({ wallet: wallet.toLowerCase(), payload }, { onConflict: 'wallet' })
    .select()
    .single();
  if (error) {
    throw error;
  }
  return data;
}

export async function loadRemoteTemplate({ wallet }) {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }
  const { data, error } = await supabase
    .from(TABLE)
    .select('wallet,payload,updated_at')
    .eq('wallet', wallet.toLowerCase())
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data;
}
