import { getSupabaseServerClient } from "@/lib/supabase/server";
import { CaviteGame } from "@/components/CaviteGame";

export default async function HomePage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  let displayName = "Licencié F.I.S.T.";
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
    if (profile?.display_name) displayName = profile.display_name;
  }

  return <CaviteGame displayName={displayName} />;
}
