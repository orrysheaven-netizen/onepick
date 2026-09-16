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
  'PRODUCT_SELECTION_REQUIRED',
  'PRODUCT_NOT_FOUND',
  'PRODUCT_NOT_ELIGIBLE',
  'PRODUCT_CATEGORY_MISMATCH',
  'PROFILE_NOT_FOUND',
  'USERNAME_INVALID',
  'USERNAME_TAKEN',
  'REVIEW_INVALID',
  'PRODUCT_NAME_INVALID',
  'PHOTO_REQUIRED',
  'PHOTO_INVALID',
  'PHOTO_TOO_LARGE',
  'PHOTO_UPLOAD_FAILED',
  'IMAGE_IMPORT_FAILED',
  'IMAGE_SOURCE_UNSUPPORTED',
  'PICK_CONFLICT',
  'PICK_NOT_FOUND',
  'COMMENT_INVALID',
  'RATE_LIMITED',
  'NETWORK_ERROR',
  'INTERNAL_ERROR',
]);

export function mapSupabaseError(error: SupabaseLikeError): AppError {
  const message = error.message?.trim();

  if (message && knownCodes.has(message as AppErrorCode)) {
    return new AppError(message as AppErrorCode, message, error);
  }

  if (error.code === '42501') {
    return new AppError('FORBIDDEN', 'FORBIDDEN', error);
  }

  if (error.code === '23505') {
    return new AppError('PICK_CONFLICT', 'PICK_CONFLICT', error);
  }

  if (error.code === 'PGRST301' || error.code === 'PGRST302') {
    return new AppError('AUTH_REQUIRED', 'AUTH_REQUIRED', error);
  }

  return new AppError('INTERNAL_ERROR', 'INTERNAL_ERROR', error);
}
