/*
 * Classement general Cavity Game : rang deterministe + annonces de palier.
 *
 * Le classement general (arcade_best_scores) n'a aujourd'hui aucune regle de
 * departage (deux joueurs a egalite de score n'ont pas d'ordre defini) et
 * aucun rang n'est jamais stocke — l'ecran classement le recalcule a chaque
 * affichage par un simple tri cote client, sans cle secondaire.
 *
 * Cette migration :
 * - ajoute une regle de departage deterministe (a score egal, le run le plus
 *   ancien gagne le meilleur rang) et l'expose via une vue de classement avec
 *   rang stable (arcade_general_ranking), utilisee a la fois par l'ecran
 *   classement et par la detection de palier ci-dessous ;
 * - stocke rank_before/rank_after sur chaque run terminee, pour afficher une
 *   fleche de mouvement sur l'ecran classement (pas de reconstruction
 *   retroactive des runs existantes : elles restent a null) ;
 * - expose finalize_arcade_run_ranking(run_id), appelee depuis
 *   app/api/runs/[id]/finish/route.ts juste apres l'enregistrement du score,
 *   qui calcule ces faits et signale si la run constitue un nouveau record
 *   personnel (route.ts decide ensuite s'il faut annoncer l'evenement cote
 *   Trounis Prono).
 *
 * Uniquement le classement general (run_type='normal') est concerne — le defi
 * quotidien (arcade_daily_scores) n'est pas touche.
 */

alter table public.arcade_runs
  add column rank_before smallint,
  add column rank_after smallint,
  add constraint arcade_runs_rank_before_positive check (rank_before is null or rank_before >= 1),
  add constraint arcade_runs_rank_after_positive check (rank_after is null or rank_after >= 1);

-- Vue existante, etendue avec le timestamp de departage (best_score_at =
-- moment du run le plus ancien ayant atteint le meilleur score du joueur).
-- distinct on() choisit, par joueur, la ligne (score desc, finished_at asc) :
-- le meilleur score, et parmi les runs a egalite sur ce score, la plus ancienne.
-- best_tir_atteint reste en 3e position et best_score_at est ajoutee en 4e :
-- CREATE OR REPLACE VIEW ne peut ni renommer ni reordonner les colonnes
-- existantes d'une vue, seulement en ajouter a la fin.
create or replace view public.arcade_best_scores
with (security_invoker = true) as
select distinct on (user_id)
  user_id,
  score as best_score,
  max(tir_atteint) over (partition by user_id) as best_tir_atteint,
  finished_at as best_score_at
from public.arcade_runs
where status = 'finished' and run_type = 'normal'
order by user_id, score desc, finished_at asc;

-- Classement general avec rang unique et deterministe. row_number() (et non
-- dense_rank(), utilise ailleurs dans l'app pour le classement pronos) est
-- volontaire ici : il garantit un seul titulaire par rang, necessaire pour
-- que la detection de palier (1ere/2e/3e place) designe toujours un joueur
-- unique meme en cas d'egalite stricte de score et de finished_at.
create or replace view public.arcade_general_ranking
with (security_invoker = true) as
select
  user_id,
  best_score,
  best_score_at,
  best_tir_atteint,
  row_number() over (order by best_score desc, best_score_at asc)::integer as rank
from public.arcade_best_scores;

-- Dernier rang connu de chaque joueur, tel qu'il etait au moment de sa
-- derniere run normale terminee — alimente la fleche de mouvement de l'ecran
-- classement (rang live actuel vs rank_after de la derniere run). Les joueurs
-- dont la derniere run precede cette migration ont rank_after = null (pas de
-- reconstruction retroactive), donc pas de fleche jusqu'a leur prochaine partie.
create or replace view public.arcade_latest_run_rank
with (security_invoker = true) as
select distinct on (user_id)
  user_id,
  rank_before,
  rank_after,
  finished_at as last_run_finished_at
from public.arcade_runs
where status = 'finished' and run_type = 'normal'
order by user_id, finished_at desc;

-- Calcule old_rank/new_rank en appliquant deux fois le meme departage : une
-- fois en excluant la run qui vient de se terminer ("comme si elle n'avait
-- pas eu lieu"), une fois en l'incluant (etat live, puisque route.ts a deja
-- persiste status='finished' avant d'appeler cette fonction). Persiste
-- rank_before/rank_after sur la run et retourne les faits pour que route.ts
-- decide s'il faut declencher une annonce cote Trounis Prono.
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
  select * into v_run from public.arcade_runs where id = p_run_id;

  if v_run.id is null or v_run.status <> 'finished' or v_run.run_type <> 'normal' then
    return query select v_run.user_id, false, false, null::integer, null::integer, null::integer, null::integer;
    return;
  end if;

  with best_excl_this_run as (
    select distinct on (user_id) user_id, score, finished_at
    from public.arcade_runs
    where status = 'finished' and run_type = 'normal' and id <> p_run_id
    order by user_id, score desc, finished_at asc
  ),
  pre as (
    select user_id, score,
      row_number() over (order by score desc, finished_at asc) as rnk
    from best_excl_this_run
  )
  select score, rnk into v_old_best, v_old_rank from pre where user_id = v_run.user_id;

  select best_score, rank into v_new_best, v_new_rank
  from public.arcade_general_ranking where user_id = v_run.user_id;

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

revoke all on function public.finalize_arcade_run_ranking(uuid) from public, anon, authenticated;
grant execute on function public.finalize_arcade_run_ranking(uuid) to service_role;
