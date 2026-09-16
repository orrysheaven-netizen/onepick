type SupabaseEnv = {
  url: string;
  publishableKey: string;
};

function requirePublicEnv(name: 'EXPO_PUBLIC_SUPABASE_URL' | 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getSupabaseEnv(): SupabaseEnv {
  return {
    url: requirePublicEnv('EXPO_PUBLIC_SUPABASE_URL'),
    publishableKey: requirePublicEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  };
}
