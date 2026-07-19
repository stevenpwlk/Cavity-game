"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";
import { getPublicEnv } from "@/lib/env";

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function getSupabaseBrowserClient() {
  const env = getPublicEnv();
  browserClient ??= createBrowserClient<Database>(env.supabaseUrl, env.supabaseAnonKey);
  return browserClient;
}
