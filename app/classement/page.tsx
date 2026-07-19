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

export default async function ClassementPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const today = parisDateISO();

  const [{ data: dailyRaw }, { data: generalRaw }] = await Promise.all([
    supabase.from("arcade_daily_scores").select("user_id, best_score").eq("challenge_date", today),
    supabase.from("arcade_best_scores").select("user_id, best_score")
  ]);

  const [daily, general] = await Promise.all([
    withDisplayNames(supabase, dailyRaw ?? []),
    withDisplayNames(supabase, generalRaw ?? [])
  ]);

  return (
    <div className="phone-shell">
      <div className="phone">
        <LeaderboardTabs daily={daily} general={general} currentUserId={user?.id ?? ""} />
      </div>
    </div>
  );
}
