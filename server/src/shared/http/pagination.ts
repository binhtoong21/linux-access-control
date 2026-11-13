import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AppError } from './app-error';

// List paging of 08-api/api.md "Quy Ước Chung": ?limit (default 50, max 200), opaque ?cursor, page {items, next_cursor}.
export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 200;

export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_LIMIT_MAX)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

/** Cursor = base64url of the JSON array holding the sort key of the last returned row. */
export function encodeCursor(key: string[]): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

/** Returns the sort key (exactly `size` strings) or throws VALIDATION_ERROR on field `cursor`. */
export function decodeCursor(cursor: string, size: number): string[] {
  try {
    const key: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(key) && key.length === size && key.every((k) => typeof k === 'string')) return key as string[];
  } catch {
    // fall through to the validation error
  }
  throw new AppError('VALIDATION_ERROR', 'Request validation failed', [{ field: 'cursor', constraints: ['cursor is invalid'] }]);
}

/** `rows` holds up to limit + 1 rows in sort order; the extra row only tells that another page exists. */
export function toPage<R, T>(rows: R[], limit: number, keyOf: (row: R) => string[], view: (row: R) => T): Page<T> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items: items.map(view), next_cursor: rows.length > limit && last ? encodeCursor(keyOf(last)) : null };
}
