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

  if (error || !data) {
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ runId: data.id, seed, challengeDate });
}
