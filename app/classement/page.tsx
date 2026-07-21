import { getSupabaseServerClient } from "@/lib/supabase/server";
import { LeaderboardTabs, type LeaderboardRow } from "@/components/LeaderboardTabs";
import { parisDateISO } from "@/lib/date";

async function withDisplayNames(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  rows: { user_id: string; best_score: number }[]
): Promise<LeaderboardRow[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.user_id);
  const { data: profiles } = await supabase.from("profiles").select("id, display_name").in("id", ids);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name as string]));
  return rows
    .map((r) => ({ userId: r.user_id, score: r.best_score, displayName: nameById.get(r.user_id) ?? "Licencié F.I.S.T." }))
    .sort((a, b) => b.score - a.score);
}

// Onglet général : rang déjà tranché côté DB (départage déterministe,
// arcade_general_ranking) — pas de tri client. La flèche de mouvement compare
// ce rang live au rank_after de la dernière run terminée du joueur
// (arcade_latest_run_rank) ; null tant qu'il n'a pas rejoué depuis la mise en
// place de la fonctionnalité (pas de reconstruction rétroactive).
async function withRankAndMovement(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  rows: { user_id: string; best_score: number; rank: number }[]
): Promise<LeaderboardRow[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.user_id);
  const [{ data: profiles }, { data: latestRanks }] = await Promise.all([
    supabase.from("profiles").select("id, display_name").in("id", ids),
    supabase.from("arcade_latest_run_rank").select("user_id, rank_after").in("user_id", ids)
  ]);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name as string]));
  const lastRankById = new Map(
    (latestRanks ?? []).map((r) => [r.user_id, r.rank_after as number | null])
  );

  return rows.map((r) => {
    const lastRank = lastRankById.get(r.user_id) ?? null;
    const rankMovement: LeaderboardRow["rankMovement"] =
      lastRank == null ? null : r.rank < lastRank ? "up" : r.rank > lastRank ? "down" : "same";
    return {
      userId: r.user_id,
      score: r.best_score,
      displayName: nameById.get(r.user_id) ?? "Licencié F.I.S.T.",
      rank: r.rank,
      rankMovement
    };
  });
}

export default async function ClassementPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const today = parisDateISO();

  const [{ data: dailyRaw }, { data: generalRaw }] = await Promise.all([
    supabase.from("arcade_daily_scores").select("user_id, best_score").eq("challenge_date", today),
    supabase
      .from("arcade_general_ranking")
      .select("user_id, best_score, rank")
      .order("rank", { ascending: true })
  ]);

  const [daily, general] = await Promise.all([
    withDisplayNames(supabase, dailyRaw ?? []),
    withRankAndMovement(supabase, generalRaw ?? [])
  ]);

  return (
    <div className="phone-shell">
      <div className="phone">
        <LeaderboardTabs daily={daily} general={general} currentUserId={user?.id ?? ""} />
      </div>
    </div>
  );
}
