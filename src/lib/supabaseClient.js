import { createClient } from "@supabase/supabase-js";

// Vite defines import.meta.env. Anything else that imports this module, which is the
// check scripts in scripts/, does not, and reading the property off it directly throws
// before the client is ever created. The guard changes nothing under Vite, and it is
// what lets the services that import this be unit tested.
const env = import.meta.env || {};
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;
