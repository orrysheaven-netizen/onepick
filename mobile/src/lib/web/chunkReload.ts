// The web build loads each screen's code on demand (asyncRoutes). After a deploy, a tab that was
// opened on the previous version asks for screen files that no longer exist; the host answers
// with index.html and the script fails to load. Reloading picks up the new version.

const CHUNK_ERROR = /ChunkLoadError|Loading (?:CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unexpected token '<'/i;

export function isChunkLoadError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return CHUNK_ERROR.test(`${error.name}: ${error.message}`);
}

const RELOAD_KEY = 'onepick:chunk-reload-at';
/** Do not reload again within this window, so a genuinely broken build cannot loop. */
export const CHUNK_RELOAD_COOLDOWN_MS = 30_000;

type SessionStore = { getItem(key: string): string | null; setItem(key: string, value: string): void };

/**
 * Records a reload and returns true when one is allowed now. Storage can be missing or throw
 * (private mode, blocked site data); then we still allow a single reload.
 */
export function claimChunkReload(store: SessionStore | undefined, now: number) {
  try {
    const last = Number(store?.getItem(RELOAD_KEY) ?? 0);
    if (Number.isFinite(last) && last > 0 && now - last < CHUNK_RELOAD_COOLDOWN_MS) return false;
    store?.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    return true;
  }
}
