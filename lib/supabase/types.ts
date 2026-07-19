/**
 * Types minimaux, écrits à la main (pas de `supabase gen types` — CLI non
 * installée dans cet environnement). Ne couvre que les tables/vues
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
        }>;
        Relationships: [];
      };
    };
    Views: {
      arcade_best_scores: {
        Row: { user_id: string; best_score: number; best_tir_atteint: number };
        Relationships: [];
      };
      arcade_daily_scores: {
        Row: { user_id: string; challenge_date: string; best_score: number };
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
  };
}
