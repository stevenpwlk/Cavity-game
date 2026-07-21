import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { dailySeed } from "@/lib/engine";
import { parisDateISO } from "@/lib/date";

const bodySchema = z.object({
  mode: z.enum(["normal", "daily"])
});

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const isDaily = parsed.data.mode === "daily";
  const challengeDate = isDaily ? parisDateISO() : null;
  // Seed dérivée de la date pour le défi du jour (identique pour tous) ;
  // aléatoire, générée serveur, pour une séance libre (le client ne choisit
  // jamais sa propre seed — sinon il pourrait la "farmer" pour un tirage facile).
  const seed = isDaily ? dailySeed(challengeDate!) : (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0);

  const admin = getSupabaseAdminClient();

  // Gauntlet homologué : un seul essai par jour, définitif (même une tentative
  // interrompue le consomme — cf arcade_runs_daily_one_per_user_idx). On vérifie
  // d'abord explicitement pour renvoyer un message utile ; l'index unique reste
  // le garde-fou en cas de course entre deux requêtes concurrentes.
  if (isDaily) {
    const { data: existing } = await admin
      .from("arcade_runs")
      .select("score, hits, tir_atteint, best_serie")
      .eq("user_id", user.id)
      .eq("run_type", "daily")
      .eq("challenge_date", challengeDate!)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        {
          error: "already_attempted_today",
          run: { score: existing.score, hits: existing.hits, tirAtteint: existing.tir_atteint, bestSerie: existing.best_serie }
        },
        { status: 409 }
      );
    }
  }

  const { data, error } = await admin
    .from("arcade_runs")
    .insert({
      user_id: user.id,
      run_type: parsed.data.mode,
      challenge_date: challengeDate,
      seed,
      status: "started"
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = violation de l'index unique (course avec une autre requête
    // concurrente sur le même jour) : même verdict que la vérification amont.
    if (isDaily && error.code === "23505") {
      return NextResponse.json({ error: "already_attempted_today", run: null }, { status: 409 });
    }
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ runId: data.id, seed, challengeDate });
}
