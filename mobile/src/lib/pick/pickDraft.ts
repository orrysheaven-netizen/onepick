import type { PickPhotoDraft } from '@/types/domain/photo';

// In-progress `/pick/new` draft, kept only so a login round trip in the SAME writing
// session can return to it (#475). Policy:
// - bound to one account; another account (or an unresolved session) never reads it,
//   and a different account discards it;
// - cleared on submit success, explicit cancel and explicit sign-out; a session that
//   merely expired keeps it for the same account's re-login;
// - web keeps it in sessionStorage (survives the OAuth full-page redirect, not a new
//   tab); native keeps it in process memory (survives the OAuth browser hop, not an
//   app restart). A short TTL also bounds a browser that restores its session;
// - no server upload: the photo is stored locally or reported as lost, never faked.

export const PICK_DRAFT_TTL_MS = 30 * 60 * 1000;
const KEY = 'onepick:pick-draft:v1';
const PHOTO_KEY = 'onepick:pick-draft-photo:v1';

export type PickDraftStep = 1 | 2 | 4 | 5;

export type PickDraftFields = {
  step: PickDraftStep;
  query: string;
  // Single-field entry: preserve the original share text separately from search and URL.
  entryRaw?: string;
  entryName?: string;
  entryUrl?: string;
  requesting: boolean;
  // Catalog-missing store: name first, then its Naver map link (#593). Older drafts omit it.
  requestPart?: 'name' | 'link';
  newName: string;
  mapLink: string;
  store: unknown;
  menuQuery: string;
  manualCategory: boolean;
  categoryQuery: string;
  menu: { categoryId: string | null; name: string } | null;
  pickScope: 'branch' | 'brand' | null;
  review: string;
};

export type RestoredPickDraft = PickDraftFields & {
  photo: PickPhotoDraft | null;
  // A photo was chosen but could not be kept (quota, unreadable, missing).
  photoLost: boolean;
};

type PhotoState = 'none' | 'stored' | 'lost';
type DraftRecord = { v: 1; userId: string; savedAt: number; photo: PhotoState; fields: PickDraftFields };
type PhotoRecord = { v: 1; userId: string; base64: string; thumbnailBase64: string; uploadId: string; sourceUrl?: string; uri?: string };

export type PickDraftBackend = {
  // 'session' rebuilds the photo from base64 (blob URLs die with the page);
  // 'memory' keeps the original file URI, valid for the running process.
  kind: 'session' | 'memory';
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function memoryBackend(): PickDraftBackend {
  const values = new Map<string, string>();
  return {
    kind: 'memory',
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

function defaultBackend(): PickDraftBackend {
  try {
    const session = (globalThis as { sessionStorage?: Pick<PickDraftBackend, 'getItem' | 'setItem' | 'removeItem'> }).sessionStorage;
    if (session) {
      return {
        kind: 'session',
        getItem: (key) => session.getItem(key),
        setItem: (key, value) => session.setItem(key, value),
        removeItem: (key) => session.removeItem(key),
      };
    }
  } catch {
    // Access to sessionStorage can throw when storage is blocked.
  }
  return memoryBackend();
}

const STEPS = new Set([1, 2, 4, 5]);

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function validFields(fields: unknown): fields is PickDraftFields {
  if (!fields || typeof fields !== 'object') return false;
  const f = fields as PickDraftFields;
  return STEPS.has(f.step) && typeof f.query === 'string' && typeof f.requesting === 'boolean'
    && (f.requestPart === undefined || f.requestPart === 'name' || f.requestPart === 'link')
    && (f.entryRaw === undefined || typeof f.entryRaw === 'string')
    && (f.entryName === undefined || typeof f.entryName === 'string')
    && (f.entryUrl === undefined || typeof f.entryUrl === 'string')
    && typeof f.newName === 'string' && typeof f.mapLink === 'string'
    && typeof f.menuQuery === 'string' && typeof f.manualCategory === 'boolean'
    && typeof f.categoryQuery === 'string' && typeof f.review === 'string'
    && (f.pickScope === null || f.pickScope === 'branch' || f.pickScope === 'brand')
    && (f.menu === null || (typeof f.menu === 'object' && typeof f.menu.name === 'string'
      && (f.menu.categoryId === null || typeof f.menu.categoryId === 'string')))
    && (f.store === null || typeof f.store === 'object');
}

export function createPickDraftStore(backend: PickDraftBackend = defaultBackend(), now: () => number = Date.now) {
  const remove = (key: string) => { try { backend.removeItem(key); } catch { /* best effort */ } };
  const readRecord = () => {
    try { return parse<DraftRecord>(backend.getItem(KEY)); } catch { return null; }
  };
  const writeRecord = (record: DraftRecord) => {
    try { backend.setItem(KEY, JSON.stringify(record)); return true; } catch { return false; }
  };

  const clear = () => { remove(KEY); remove(PHOTO_KEY); };

  // Any signed-in account other than the owner discards the draft (account switch).
  const discardForOtherUser = (userId: string) => {
    const record = readRecord();
    if (record && record.userId !== userId) clear();
  };

  // The draft record is the source of truth; the photo record only backs a 'stored'
  // marker. When storage is too full for both, the photo is given up ('lost', so the
  // restore asks for it again) to keep the latest non-photo input. When even that
  // cannot be written, everything is cleared so an older draft is never restored.
  const dropPhoto = (record: DraftRecord) => {
    remove(PHOTO_KEY);
    if (writeRecord({ ...record, photo: 'lost' })) return true;
    clear();
    return false;
  };

  // Returns true only when these latest fields are what a restore would return (the
  // photo may have been downgraded to 'lost' to make room). On false nothing is
  // restorable; the screen keeps working from memory.
  const save = (userId: string, fields: PickDraftFields) => {
    const previous = readRecord();
    if (previous && previous.userId !== userId) clear();
    const photo: PhotoState = previous && previous.userId === userId ? previous.photo : 'none';
    const record: DraftRecord = { v: 1, userId, savedAt: now(), photo, fields };
    if (writeRecord(record)) return true;
    if (photo === 'stored') return dropPhoto(record);
    clear();
    return false;
  };

  // null removes the photo. Returns true only when the photo is actually restorable;
  // a failed or partial write is recorded as 'lost' (or clears the draft) instead of
  // pretending the photo was kept.
  const savePhoto = (userId: string, photo: PickPhotoDraft | null) => {
    const record = readRecord();
    if (!record || record.userId !== userId) return false;
    if (!photo) {
      remove(PHOTO_KEY);
      if (writeRecord({ ...record, photo: 'none', savedAt: now() })) return true;
      clear();
      return false;
    }
    const stored: PhotoRecord = {
      v: 1, userId, base64: photo.base64, thumbnailBase64: photo.thumbnailBase64,
      uploadId: photo.uploadId, sourceUrl: photo.sourceUrl,
      uri: backend.kind === 'memory' ? photo.uri : undefined,
    };
    let photoWritten = true;
    try { backend.setItem(PHOTO_KEY, JSON.stringify(stored)); } catch { photoWritten = false; }
    const next: DraftRecord = { ...record, savedAt: now() };
    // Both writes must land for 'stored'; a photo record without its marker is dropped.
    if (photoWritten && writeRecord({ ...next, photo: 'stored' })) return true;
    dropPhoto(next);
    return false;
  };

  const loadPhoto = (userId: string): PickPhotoDraft | null => {
    let stored: PhotoRecord | null = null;
    try { stored = parse<PhotoRecord>(backend.getItem(PHOTO_KEY)); } catch { return null; }
    if (!stored || stored.userId !== userId || typeof stored.base64 !== 'string' || !stored.base64
      || typeof stored.thumbnailBase64 !== 'string' || typeof stored.uploadId !== 'string') return null;
    const uri = backend.kind === 'memory' && typeof stored.uri === 'string' && stored.uri
      ? stored.uri : `data:image/jpeg;base64,${stored.base64}`;
    return { uri, base64: stored.base64, thumbnailBase64: stored.thumbnailBase64, uploadId: stored.uploadId, sourceUrl: stored.sourceUrl };
  };

  // Only for the resolved owner. Another account's draft is discarded, never returned.
  const load = (userId: string): RestoredPickDraft | null => {
    const record = readRecord();
    if (!record) return null;
    if (record.v !== 1 || record.userId !== userId || !validFields(record.fields)
      || typeof record.savedAt !== 'number' || now() - record.savedAt > PICK_DRAFT_TTL_MS) {
      clear();
      return null;
    }
    let photo: PickPhotoDraft | null = null;
    let photoLost = record.photo === 'lost';
    if (record.photo === 'stored') {
      photo = loadPhoto(userId);
      photoLost = !photo;
    }
    return { ...record.fields, photo, photoLost };
  };

  return { save, savePhoto, load, clear, discardForOtherUser };
}

let shared: ReturnType<typeof createPickDraftStore> | null = null;
export function pickDraftStore() {
  shared ??= createPickDraftStore();
  return shared;
}

export function clearPickDraft() { pickDraftStore().clear(); }
export function discardPickDraftForOtherUser(userId: string) { pickDraftStore().discardForOtherUser(userId); }
