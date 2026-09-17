// Static web rendering has no browser storage. Native builds resolve the
// platform-specific module in storage.native.ts.
export const authStorage = typeof window === 'undefined' ? undefined : window.localStorage;
