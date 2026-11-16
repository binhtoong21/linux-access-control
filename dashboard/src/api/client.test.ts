import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, ApiError, onUnauthorized } from './client';

describe('api client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GET sends no X-Requested-With', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api('GET', '/users');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/users');
    expect(init.method).toBe('GET');
    expect(init.headers['X-Requested-With']).toBeUndefined();
    expect(init.headers['Accept']).toBe('application/json');
    expect(init.credentials).toBe('same-origin');
  });

  it('POST sends X-Requested-With: dashboard and JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api('POST', '/auth/login', { username: 'root', password: '123' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/auth/login');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Requested-With']).toBe('dashboard');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ username: 'root', password: '123' }));
  });

  it('204 returns undefined', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await api('POST', '/auth/logout');
    expect(result).toBeUndefined();
  });

  it('error body throws ApiError with code/message/details', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Dữ liệu không hợp lệ',
            details: [{ field: 'name', message: 'Tên bắt buộc' }],
          },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('POST', '/zones', {})).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(400);
      expect(apiErr.code).toBe('VALIDATION_ERROR');
      expect(apiErr.message).toBe('Dữ liệu không hợp lệ');
      expect(apiErr.details).toEqual([{ field: 'name', message: 'Tên bắt buộc' }]);
      return true;
    });
  });

  it('HTML 502 throws NETWORK_ERROR', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => '<html><body>502 Bad Gateway</body></html>',
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('GET', '/workstations')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(502);
      expect(apiErr.code).toBe('NETWORK_ERROR');
      expect(apiErr.message).toBe('Không kết nối được máy chủ');
      return true;
    });
  });

  it('fetch rejection throws NETWORK_ERROR with status 0', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('GET', '/workstations')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(0);
      expect(apiErr.code).toBe('NETWORK_ERROR');
      expect(apiErr.message).toBe('Không kết nối được máy chủ');
      return true;
    });
  });

  it('401 on /workstations calls the onUnauthorized handler, 401 on /auth/me does not', async () => {
    const handler = vi.fn();
    const unsubscribe = onUnauthorized(handler);

    const fetchMock = vi.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: false,
        status: 401,
        text: async () =>
          JSON.stringify({
            error: {
              code: 'UNAUTHORIZED',
              message: 'Hết phiên đăng nhập',
            },
          }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    // Call /workstations -> should invoke handler
    await expect(api('GET', '/workstations')).rejects.toThrow(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);

    // Call /auth/me -> should NOT invoke handler
    await expect(api('GET', '/auth/me')).rejects.toThrow(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
