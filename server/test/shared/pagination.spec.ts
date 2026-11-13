import { AppError } from '../../src/shared/http/app-error';
import { decodeCursor, encodeCursor, toPage } from '../../src/shared/http/pagination';

describe('pagination', () => {
  it('round-trips a cursor', () => {
    expect(decodeCursor(encodeCursor(['2026-11-13 10:00:00.123456+00', 'abc']), 2)).toEqual(['2026-11-13 10:00:00.123456+00', 'abc']);
  });

  it.each([['garbage'], [encodeCursor(['a'])], [Buffer.from('{"a":1}').toString('base64url')], [Buffer.from('[1,2]').toString('base64url')]])(
    'rejects invalid cursor %s',
    (cursor) => {
      expect.assertions(2);
      try {
        decodeCursor(cursor, 2);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('VALIDATION_ERROR');
      }
    },
  );

  it('sets next_cursor only when an extra row exists', () => {
    const rows = [{ k: 'a' }, { k: 'b' }, { k: 'c' }];
    const full = toPage(rows, 2, (r) => [r.k], (r) => r.k);
    expect(full.items).toEqual(['a', 'b']);
    expect(decodeCursor(full.next_cursor!, 1)).toEqual(['b']);
    expect(toPage(rows, 3, (r) => [r.k], (r) => r.k).next_cursor).toBeNull();
    expect(toPage([], 3, (r: { k: string }) => [r.k], (r) => r.k)).toEqual({ items: [], next_cursor: null });
  });
});
