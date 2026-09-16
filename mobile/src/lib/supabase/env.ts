type SupabaseEnv = {
  url: string;
  publishableKey: string;
};

function requirePublicEnv(name: string, configuredValue: string | undefined): string {
  const value = configuredValue?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getSupabaseEnv(): SupabaseEnv {
  return {
    // Expo only inlines environment variables accessed with static dot notation.
    url: requirePublicEnv('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
    publishableKey: requirePublicEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  };
}
