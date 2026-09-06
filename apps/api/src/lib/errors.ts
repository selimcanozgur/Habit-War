/**
 * Application error types.
 *
 * The spec's API section defined no error format at all, which means every client
 * would have had to guess. One shape, one place: `{ error: { code, message, details? } }`.
 */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError('BAD_REQUEST', message, details);

export const notFound = (message: string): AppError => new AppError('NOT_FOUND', message);

export const conflict = (message: string, details?: unknown): AppError =>
  new AppError('CONFLICT', message, details);

export const forbidden = (message: string): AppError => new AppError('FORBIDDEN', message);

export const unprocessable = (message: string, details?: unknown): AppError =>
  new AppError('UNPROCESSABLE', message, details);
