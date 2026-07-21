/*
 * arcade_general_ranking et arcade_latest_run_rank (migration precedente)
 * n'ont pas recu le meme GRANT SELECT que arcade_best_scores/
 * arcade_daily_scores — celles-ci l'avaient obtenu implicitement (privileges
 * par defaut du schema public), pas les deux nouvelles vues. Consequence en
 * prod : classement general vide pour tout le monde (permission denied,
 * silencieusement avale cote client), alors que les donnees existent bien.
 */

grant select on public.arcade_general_ranking to authenticated;
grant select on public.arcade_latest_run_rank to authenticated;
