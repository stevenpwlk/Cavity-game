import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { getPublicEnv } from "@/lib/env";

let adminClient: ReturnType<typeof createClient<Database>> | null = null;

/**
 * Client à clé de service — bypass RLS. Réservé aux routes API serveur qui
 * écrivent un score déjà recalculé/vérifié (jamais exposé au navigateur).
 */
export function getSupabaseAdminClient() {
  const env = getPublicEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY manquant côté serveur.");
  }

  adminClient ??= createClient<Database>(env.supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  return adminClient;
}
