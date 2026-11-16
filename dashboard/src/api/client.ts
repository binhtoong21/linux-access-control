export const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type UnauthorizedHandler = () => void;
const unauthorizedHandlers = new Set<UnauthorizedHandler>();

export function onUnauthorized(handler: UnauthorizedHandler): () => void {
  unauthorizedHandlers.add(handler);
  return () => {
    unauthorizedHandlers.delete(handler);
  };
}

function notifyUnauthorized(): void {
  for (const handler of Array.from(unauthorizedHandlers)) {
    try {
      handler();
    } catch (err) {
      console.error('Error in onUnauthorized handler', err);
    }
  }
}

export async function api<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (method !== 'GET') {
    headers['X-Requested-With'] = 'dashboard';
  }

  let requestBody: string | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      credentials: 'same-origin',
      headers,
      body: requestBody,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Không kết nối được máy chủ');
  }

  if (res.status === 204) {
    return undefined as T;
  }

  let text = '';
  try {
    text = await res.text();
  } catch {
    // If reading body failed
    text = '';
  }

  if (!res.ok) {
    const isAuthExempt =
      path === '/auth/login' ||
      path === '/auth/me' ||
      path.startsWith('/auth/login?') ||
      path.startsWith('/auth/me?');

    if (res.status === 401 && !isAuthExempt) {
      notifyUnauthorized();
    }

    if (text) {
      try {
        const json = JSON.parse(text);
        if (json && typeof json.error === 'object' && json.error !== null) {
          const { code, message, details } = json.error;
          if (typeof code === 'string' && typeof message === 'string') {
            throw new ApiError(res.status, code, message, details);
          }
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
      }
    }

    throw new ApiError(res.status || 0, 'NETWORK_ERROR', 'Không kết nối được máy chủ');
  }

  if (!text.trim()) {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(res.status || 0, 'NETWORK_ERROR', 'Không kết nối được máy chủ');
  }
}
