/**
 * Types minimaux, écrits à la main (pas de `supabase gen types` — CLI non
 * installée dans cet environnement). Ne couvre que les tables/vues/fonctions
 * effectivement utilisées par le jeu ; `profiles` et `auth.users`
 * appartiennent au projet Supabase partagé avec les pronos.
 *
 * Forme exigée par le générique Database de @supabase/supabase-js 2.108 :
 * chaque table a Row/Insert/Update/Relationships, chaque vue a
 * Row/Relationships, et Functions doit être présent (même vide).
 *
 * IMPORTANT : les Row doivent être des littéraux de type INLINE, pas des
 * interfaces nommées séparément — avec une interface nommée, l'inférence
 * générique profondément imbriquée de supabase-js résout Schema en `never`
 * (bizarrerie de ce compilateur, vérifiée par isolation). Ne pas factoriser.
 */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; display_name: string; avatar_key: string };
        Insert: { id: string; display_name: string; avatar_key?: string };
        Update: Partial<{ display_name: string; avatar_key: string }>;
        Relationships: [];
      };
      arcade_runs: {
        Row: {
          id: string;
          user_id: string;
          run_type: "normal" | "daily";
          challenge_date: string | null;
          seed: number;
          shot_log: unknown;
          score: number;
          hits: number;
          tir_atteint: number;
          best_serie: number;
          status: "started" | "finished";
          created_at: string;
          finished_at: string | null;
          rank_before: number | null;
          rank_after: number | null;
        };
        Insert: {
          user_id: string;
          run_type: "normal" | "daily";
          challenge_date?: string | null;
          seed: number;
          status?: "started" | "finished";
        };
        Update: Partial<{
          shot_log: unknown;
          score: number;
          hits: number;
          tir_atteint: number;
          best_serie: number;
          status: "started" | "finished";
          finished_at: string;
          rank_before: number | null;
          rank_after: number | null;
        }>;
        Relationships: [];
      };
    };
    Views: {
      arcade_best_scores: {
        Row: {
          user_id: string;
          best_score: number;
          best_tir_atteint: number;
          best_score_at: string;
        };
        Relationships: [];
      };
      arcade_daily_scores: {
        Row: { user_id: string; challenge_date: string; best_score: number };
        Relationships: [];
      };
      /** Classement général avec rang tranché côté DB (départage score desc, best_score_at asc). */
      arcade_general_ranking: {
        Row: {
          user_id: string;
          best_score: number;
          best_score_at: string;
          best_tir_atteint: number;
          rank: number;
        };
        Relationships: [];
      };
      /** Rang tel qu'il était à la dernière run terminée de chaque joueur — alimente la flèche de mouvement. */
      arcade_latest_run_rank: {
        Row: {
          user_id: string;
          rank_before: number | null;
          rank_after: number | null;
          last_run_finished_at: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      /** Calcule old_rank/new_rank pour la run qui vient de se terminer, persiste rank_before/rank_after. */
      finalize_arcade_run_ranking: {
        Args: { p_run_id: string };
        Returns: {
          user_id: string;
          is_new_best: boolean;
          is_new_entrant: boolean;
          old_rank: number | null;
          new_rank: number | null;
          old_best: number | null;
          new_best: number | null;
        }[];
      };
      /** Côté Trounis Prono (même base) : annonce un palier dans le Chat + notif push si applicable. */
      announce_cavity_milestone: {
        Args: {
          p_user_id: string;
          p_is_new_entrant: boolean;
          p_old_rank: number | null;
          p_new_rank: number | null;
          p_dedup_key: string;
        };
        Returns: { skipped: boolean; reason?: string; category?: string; message_id?: string };
      };
    };
  };
}
