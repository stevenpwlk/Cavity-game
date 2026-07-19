import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { simulateRun } from "@/lib/engine";

const shotSchema = z.object({
  dx: z.number().finite(),
  dy: z.number().finite(),
  readySeconds: z.number().finite().min(0).max(120)
});

const bodySchema = z.object({
  shots: z.array(shotSchema).min(1).max(500)
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;

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

  const admin = getSupabaseAdminClient();
  const { data: run, error: fetchError } = await admin
    .from("arcade_runs")
    .select("id, user_id, seed, status")
    .eq("id", runId)
    .single();

  if (fetchError || !run) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (run.user_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (run.status !== "started") {
    return NextResponse.json({ error: "already_finished" }, { status: 409 });
  }

  // Autorité du score : rejeu déterministe côté serveur, seed émise par le
  // serveur au démarrage — les valeurs envoyées par le client ne sont jamais
  // utilisées telles quelles, seuls les vecteurs de tir bruts le sont.
  const result = simulateRun(Number(run.seed), parsed.data.shots);

  const { error: updateError } = await admin
    .from("arcade_runs")
    .update({
      shot_log: parsed.data.shots,
      score: result.score,
      hits: result.hits,
      tir_atteint: result.tirAtteint,
      best_serie: result.bestSerie,
      status: "finished",
      finished_at: new Date().toISOString()
    })
    .eq("id", runId);

  if (updateError) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({
    score: result.score,
    hits: result.hits,
    tirAtteint: result.tirAtteint,
    bestSerie: result.bestSerie
  });
}
