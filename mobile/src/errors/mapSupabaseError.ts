import { AppError, type AppErrorCode } from './appError';

type SupabaseLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

const knownCodes = new Set<AppErrorCode>([
  'AUTH_REQUIRED',
  'AUTH_FAILED',
  'FORBIDDEN',
  'CATEGORY_NOT_FOUND',
  'CATEGORY_NOT_PICKABLE',
  'CATEGORY_INVALID',
  'CATEGORY_LABEL_INVALID',
  'ITEM_SELECTION_REQUIRED',
  'ITEM_NOT_FOUND',
  'ITEM_NOT_ELIGIBLE',
  'ITEM_ALREADY_PENDING',
  'ITEM_CATEGORY_MISMATCH',
  'ITEM_ALIAS_INVALID',
  'ITEM_ALIAS_CONFLICT',
  'ITEM_ALIAS_REDUNDANT',
  'PROFILE_NOT_FOUND',
  'USERNAME_INVALID',
  'USERNAME_TAKEN',
  'REVIEW_INVALID',
  'PURCHASE_URL_INVALID',
  'PURCHASE_TIP_INVALID',
  'PURCHASE_TIP_WITHOUT_URL',
  'ITEM_NAME_INVALID',
  'PHOTO_REQUIRED',
  'PHOTO_INVALID',
  'PHOTO_TOO_LARGE',
  'PHOTO_UPLOAD_FAILED',
  'IMAGE_IMPORT_FAILED',
  'IMAGE_SOURCE_UNSUPPORTED',
  'PICK_CONFLICT',
  'ITEM_ALREADY_PICKED',
  'PICK_CHANNEL_INVALID',
  'PICK_CHANNEL_MISMATCH',
  'PICK_CHANNEL_REQUIRED',
  'PICK_NOT_FOUND',
  'COMMENT_INVALID',
  'BLOCK_SELF',
  'FOLLOW_SELF',
  'FOLLOW_BLOCKED',
  'REPORT_INVALID',
  'REPORT_TARGET_NOT_FOUND',
  'REPORT_SELF',
  'REPORT_DUPLICATE',
  'ACCOUNT_DELETE_FAILED',
  'RATE_LIMITED',
  'LINK_INVALID',
  'PROVIDER_NOT_FOUND',
  'NETWORK_ERROR',
  'INTERNAL_ERROR',
]);

const databaseCodeMap: Record<string, AppErrorCode> = {
  ALIAS_INVALID: 'ITEM_ALIAS_INVALID',
  ALIAS_CONFLICT: 'ITEM_ALIAS_CONFLICT',
  ALIAS_REDUNDANT: 'ITEM_ALIAS_REDUNDANT',
  BLOCK_SELF: 'BLOCK_SELF',
  REPORT_INVALID: 'REPORT_INVALID',
  REPORT_TARGET_NOT_FOUND: 'REPORT_TARGET_NOT_FOUND',
  REPORT_SELF: 'REPORT_SELF',
};

const NETWORK_FAILURE = /Failed to fetch|Network request failed|NetworkError when attempting to fetch|Load failed|fetch failed/i;

export function mapSupabaseError(error: SupabaseLikeError): AppError {
  const message = error.message?.trim();

  if (message && knownCodes.has(message as AppErrorCode)) {
    return new AppError(message as AppErrorCode, message, error);
  }

  if (message && databaseCodeMap[message]) {
    const code = databaseCodeMap[message];
    return new AppError(code, code, error);
  }

  if (error.code === '42501') {
    return new AppError('FORBIDDEN', 'FORBIDDEN', error);
  }

  if (error.code === '23505') {
    return new AppError('PICK_CONFLICT', 'PICK_CONFLICT', error);
  }

  if (error.code === 'PGRST301' || error.code === 'PGRST302' || error.code === 'PGRST303') {
    return new AppError('AUTH_REQUIRED', 'AUTH_REQUIRED', error);
  }

  // supabase-js reports a request that never reached the server (offline, DNS, CORS) with an
  // empty code and the fetch error text; show "check your connection", not a generic failure.
  if (!error.code && message && NETWORK_FAILURE.test(message)) {
    return new AppError('NETWORK_ERROR', 'NETWORK_ERROR', error);
  }

  return new AppError('INTERNAL_ERROR', 'INTERNAL_ERROR', error);
}
