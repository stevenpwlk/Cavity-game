-- CAVITÉ : séances de jeu (runs) et classements.
-- Toute écriture (start/finish) passe par les routes API Next.js avec la
-- clé de service (score toujours recalculé/vérifié côté serveur) : aucune
-- policy INSERT/UPDATE n'est accordée au rôle authenticated, volontairement.

create table public.arcade_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_type text not null check (run_type in ('normal', 'daily')),
  challenge_date date,
  seed bigint not null,
  shot_log jsonb not null default '[]'::jsonb,
  score integer not null default 0,
  hits integer not null default 0,
  tir_atteint integer not null default 0,
  best_serie integer not null default 0,
  status text not null default 'started' check (status in ('started', 'finished')),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint arcade_runs_daily_date check (
    (run_type = 'daily' and challenge_date is not null)
    or (run_type = 'normal' and challenge_date is null)
  )
);

create index arcade_runs_user_idx on public.arcade_runs (user_id);
create index arcade_runs_daily_idx on public.arcade_runs (challenge_date) where run_type = 'daily';
create index arcade_runs_status_idx on public.arcade_runs (status);

alter table public.arcade_runs enable row level security;

-- Chacun lit toujours ses propres runs (y compris en cours) ...
create policy "arcade_runs select own" on public.arcade_runs
  for select
  to authenticated
  using (user_id = auth.uid());

-- ... et tout le monde lit les runs terminées des autres, pour les classements.
create policy "arcade_runs select finished" on public.arcade_runs
  for select
  to authenticated
  using (status = 'finished');

-- Classement général : meilleur score personnel (runs normales terminées).
create or replace view public.arcade_best_scores
with (security_invoker = true) as
select user_id, max(score) as best_score, max(tir_atteint) as best_tir_atteint
from public.arcade_runs
where status = 'finished' and run_type = 'normal'
group by user_id;

-- Classement du défi homologué du jour : meilleur score du jour par joueur.
create or replace view public.arcade_daily_scores
with (security_invoker = true) as
select user_id, challenge_date, max(score) as best_score
from public.arcade_runs
where status = 'finished' and run_type = 'daily'
group by user_id, challenge_date;
