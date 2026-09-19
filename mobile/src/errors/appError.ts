export type AppErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_FAILED'
  | 'FORBIDDEN'
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_NOT_PICKABLE'
  | 'CATEGORY_INVALID'
  | 'ITEM_SELECTION_REQUIRED'
  | 'ITEM_NOT_FOUND'
  | 'ITEM_NOT_ELIGIBLE'
  | 'ITEM_CATEGORY_MISMATCH'
  | 'ITEM_ALIAS_INVALID'
  | 'ITEM_ALIAS_CONFLICT'
  | 'ITEM_ALIAS_REDUNDANT'
  | 'PROFILE_NOT_FOUND'
  | 'USERNAME_INVALID'
  | 'USERNAME_TAKEN'
  | 'REVIEW_INVALID'
  | 'ITEM_NAME_INVALID'
  | 'PHOTO_REQUIRED'
  | 'PHOTO_INVALID'
  | 'PHOTO_TOO_LARGE'
  | 'PHOTO_UPLOAD_FAILED'
  | 'IMAGE_IMPORT_FAILED'
  | 'IMAGE_SOURCE_UNSUPPORTED'
  | 'PICK_CONFLICT'
  | 'PICK_NOT_FOUND'
  | 'COMMENT_INVALID'
  | 'BLOCK_SELF'
  | 'REPORT_INVALID'
  | 'REPORT_TARGET_NOT_FOUND'
  | 'REPORT_SELF'
  | 'REPORT_DUPLICATE'
  | 'ACCOUNT_DELETE_FAILED'
  | 'RATE_LIMITED'
  | 'AI_NOT_CONFIGURED'
  | 'AI_NOT_ENOUGH_PICKS'
  | 'AI_REVIEW_FAILED'
  | 'AI_REVIEW_STALE'
  | 'CATALOG_NOT_CONFIGURED'
  | 'NETWORK_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly cause?: unknown;

  constructor(
    public readonly code: AppErrorCode,
    message: string = code,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.cause = cause;
  }
}
