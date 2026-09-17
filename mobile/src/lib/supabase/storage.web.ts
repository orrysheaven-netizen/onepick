// Static web rendering has no browser storage.
export const authStorage = typeof window === 'undefined' ? undefined : window.localStorage;
