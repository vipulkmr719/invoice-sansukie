/**
 * Error handling (security requirement #10).
 *
 * Two kinds of failure exist in this app:
 *
 *  - `AppError` — something the user can understand and act on. Its message is
 *    written in Japanese and is safe to render.
 *  - everything else — bugs, driver failures, connection errors. These may
 *    embed connection strings, SQL fragments or stack traces, so they are
 *    logged server-side and replaced with a generic message before they reach
 *    the browser.
 */

export type AppErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'QUOTA_EXCEEDED'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'ログインが必要です。') {
    super('UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'データが見つかりませんでした。') {
    super('NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'すでに登録されています。') {
    super('CONFLICT', message);
    this.name = 'ConflictError';
  }
}

/**
 * The account has hit a plan limit. Distinct from a validation failure: the
 * input was fine, the plan is what stopped it, so the UI offers an upgrade
 * rather than asking the user to correct a field.
 */
export class QuotaExceededError extends AppError {
  constructor(message: string) {
    super('QUOTA_EXCEEDED', message);
    this.name = 'QuotaExceededError';
  }
}

export class ValidationError extends AppError {
  constructor(message = '入力内容に誤りがあります。') {
    super('VALIDATION', message);
    this.name = 'ValidationError';
  }
}

const GENERIC_MESSAGE =
  '処理中にエラーが発生しました。しばらくしてからもう一度お試しください。';

/**
 * Convert any thrown value into a message that is safe to show to a user.
 * Unknown errors are logged with their stack on the server and reduced to a
 * generic sentence for the client.
 */
export function toPublicErrorMessage(error: unknown, context?: string): string {
  if (error instanceof AppError) {
    return error.message;
  }

  const label = context ? `[${context}]` : '[unhandled]';
  // Server-side log only. Never returned to the caller.
  console.error(label, error);

  return GENERIC_MESSAGE;
}

export { GENERIC_MESSAGE };
