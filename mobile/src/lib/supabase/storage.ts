// Static web rendering has no browser storage; Supabase uses memory in that case.
export const authStorage = typeof window === 'undefined' ? undefined : window.localStorage;
