export type AppErrorCode =
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_NOT_PICKABLE'
  | 'PRODUCT_NOT_FOUND'
  | 'PRODUCT_NOT_ELIGIBLE'
  | 'PRODUCT_CATEGORY_MISMATCH'
  | 'PROFILE_NOT_FOUND'
  | 'REVIEW_INVALID';

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
