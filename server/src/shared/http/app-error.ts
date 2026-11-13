import { HttpException, ValidationError } from '@nestjs/common';

// Error codes of 08-api/api.md "Error Codes"; each code has one fixed HTTP status.
// Codes of later modules (INVALID_UID, CARD_ALREADY_BOUND, ...) are added with those modules.
export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  INVALID_CREDENTIALS: 401,
  UNAUTHORIZED: 401,
  CSRF_HEADER_REQUIRED: 403,
  NOT_FOUND: 404,
  DUPLICATE: 409,
  INVALID_STATE_TRANSITION: 409,
  LAST_ACTIVE_ADMIN: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown[],
  ) {
    super(message);
    this.name = 'AppError';
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }
}

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown[] };
}

export interface ErrorResponse {
  status: number;
  body: ErrorBody;
}

// Framework exceptions (unknown route, malformed JSON, ...) mapped by HTTP status; anything else is HTTP_ERROR.
const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  404: 'NOT_FOUND',
  429: 'RATE_LIMITED',
};

function build(status: number, code: string, message: string, details?: unknown[]): ErrorResponse {
  const error: ErrorBody['error'] = { code, message };
  if (details && details.length > 0) error.details = details;
  return { status, body: { error } };
}

export function toErrorResponse(exception: unknown): ErrorResponse {
  if (exception instanceof AppError) {
    return build(exception.status, exception.code, exception.message, exception.details);
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status >= 500) return build(status, 'INTERNAL_ERROR', 'Internal server error');
    return build(status, CODE_BY_STATUS[status] ?? 'HTTP_ERROR', exception.message);
  }
  // Never echo unexpected errors: they can carry SQL, paths or secrets.
  return build(500, 'INTERNAL_ERROR', 'Internal server error');
}

export interface FieldError {
  field: string;
  constraints: string[];
}

export function validationDetails(errors: ValidationError[], prefix = ''): FieldError[] {
  return errors.flatMap((e) => {
    const field = prefix ? `${prefix}.${e.property}` : e.property;
    const own = e.constraints ? [{ field, constraints: Object.values(e.constraints) }] : [];
    return [...own, ...validationDetails(e.children ?? [], field)];
  });
}

export function validationExceptionFactory(errors: ValidationError[]): AppError {
  return new AppError('VALIDATION_ERROR', 'Request validation failed', validationDetails(errors));
}
