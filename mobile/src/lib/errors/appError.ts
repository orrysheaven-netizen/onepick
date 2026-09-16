export type AppErrorCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_NOT_PICKABLE'
  | 'PRODUCT_NOT_FOUND'
  | 'PRODUCT_NOT_ELIGIBLE'
  | 'PRODUCT_CATEGORY_MISMATCH'
  | 'REVIEW_INVALID'
  | 'PICK_CONFLICT'
  | 'PICK_NOT_FOUND'
  | 'COMMENT_INVALID'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly cause?: unknown;

  constructor(code: AppErrorCode, message?: string, cause?: unknown) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
  }
}
