/*
 * finalize_arcade_run_ranking (migration 20260721000100) declare
 * RETURNS TABLE(user_id uuid, ...) — ce qui rend "user_id" ambigu partout
 * dans le corps de la fonction : PL/pgSQL cree une variable OUT implicite
 * "user_id" en plus de la colonne du meme nom dans les requetes internes
 * (best_excl_this_run, arcade_general_ranking). Resultat en prod : chaque
 * appel echouait avec "column reference user_id is ambiguous" (42702),
 * silencieusement avale par le best-effort de announceCavityMilestone —
 * aucune annonce ne partait jamais, rank_before/rank_after restaient null.
 *
 * Corrige en qualifiant/renommant toutes les references a user_id dans le
 * corps de la fonction (jamais en bare identifier).
 */
create or replace function public.finalize_arcade_run_ranking(p_run_id uuid)
returns table (
  user_id uuid,
  is_new_best boolean,
  is_new_entrant boolean,
  old_rank integer,
  new_rank integer,
  old_best integer,
  new_best integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.arcade_runs%rowtype;
  v_old_rank integer;
  v_new_rank integer;
  v_old_best integer;
  v_new_best integer;
begin
  select * into v_run from public.arcade_runs ar where ar.id = p_run_id;

  if v_run.id is null or v_run.status <> 'finished' or v_run.run_type <> 'normal' then
    return query select v_run.user_id, false, false, null::integer, null::integer, null::integer, null::integer;
    return;
  end if;

  with best_excl_this_run as (
    select distinct on (ar.user_id)
      ar.user_id as ranked_user_id, ar.score as ranked_score, ar.finished_at as ranked_finished_at
    from public.arcade_runs ar
    where ar.status = 'finished' and ar.run_type = 'normal' and ar.id <> p_run_id
    order by ar.user_id, ar.score desc, ar.finished_at asc
  ),
  pre as (
    select ranked_user_id, ranked_score,
      row_number() over (order by ranked_score desc, ranked_finished_at asc) as rnk
    from best_excl_this_run
  )
  select pre.ranked_score, pre.rnk into v_old_best, v_old_rank
  from pre where pre.ranked_user_id = v_run.user_id;

  select agr.best_score, agr.rank into v_new_best, v_new_rank
  from public.arcade_general_ranking agr where agr.user_id = v_run.user_id;

  update public.arcade_runs
  set rank_before = v_old_rank, rank_after = v_new_rank
  where id = p_run_id;

  return query select
    v_run.user_id,
    (v_old_best is null or v_run.score > v_old_best),
    (v_old_best is null),
    v_old_rank,
    v_new_rank,
    v_old_best,
    v_new_best;
end;
$$;
