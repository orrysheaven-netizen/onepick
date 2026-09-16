export type AppErrorCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_NOT_PICKABLE'
  | 'PRODUCT_NOT_FOUND'
  | 'PRODUCT_NOT_ELIGIBLE'
  | 'PRODUCT_CATEGORY_MISMATCH'
  | 'PROFILE_NOT_FOUND'
  | 'REVIEW_INVALID'
  | 'PICK_CONFLICT'
  | 'PICK_NOT_FOUND'
  | 'COMMENT_INVALID'
  | 'RATE_LIMITED'
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
