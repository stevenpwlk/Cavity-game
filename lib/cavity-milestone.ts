import "server-only";

import type { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Detecte un palier de classement general (nouvel entrant, record personnel,
 * entree en 3e/2e/1ere place) pour la run qui vient de se terminer, et si
 * applicable declenche l'annonce cote Chat Trounis Prono (message + notif
 * push selon le cas). Strictement best-effort : appelee via after() depuis
 * finish/route.ts, ne doit jamais lever d'exception ni retarder la reponse
 * deja envoyee au client.
 */
export async function announceCavityMilestone(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  runId: string,
  userId: string
): Promise<void> {
  try {
    const { data, error } = await admin.rpc("finalize_arcade_run_ranking", {
      p_run_id: runId
    });
    if (error) {
      console.error("[cavity-milestone] finalize_arcade_run_ranking failed", error);
      return;
    }

    const row = data?.[0];
    if (!row?.is_new_best) return;

    const { error: announceError } = await admin.rpc("announce_cavity_milestone", {
      p_user_id: userId,
      p_is_new_entrant: row.is_new_entrant,
      p_old_rank: row.old_rank,
      p_new_rank: row.new_rank,
      p_dedup_key: `cavity_milestone:${runId}`
    });
    if (announceError) {
      console.error("[cavity-milestone] announce_cavity_milestone failed", announceError);
    }
  } catch (err) {
    console.error("[cavity-milestone] best-effort failure", err);
  }
}
