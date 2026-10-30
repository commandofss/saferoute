import { createClient } from "@supabase/supabase-js";

// Only the public anon key is used here. Never put the service key in this project.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-key"
);
