import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './AuthProvider';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function TestConsumer() {
  const { admin, loading, login } = useAuth();
  return (
    <div>
      <div data-testid="loading">{loading ? 'loading' : 'not-loading'}</div>
      <div data-testid="admin">{admin ? admin.display_name : 'no-admin'}</div>
      <button onClick={() => login('admin', 'password')}>Đăng nhập</button>
    </div>
  );
}

describe('AuthProvider race condition', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('startup me() does not overwrite newer login state', async () => {
    const user = userEvent.setup();
    const initialMeDeferred = deferred<any>();
    let meCallCount = 0;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/auth/me') {
        meCallCount++;
        if (meCallCount === 1) {
          return initialMeDeferred.promise;
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 'adm-1', username: 'admin', display_name: 'Quản trị viên' }),
        });
      }
      if (url === '/api/v1/auth/login' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 204,
          text: async () => '',
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </QueryClientProvider>,
    );

    // Initial me() is pending
    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
    expect(screen.getByTestId('admin')).toHaveTextContent('no-admin');

    // User logs in while initial me() is still in-flight
    const loginBtn = screen.getByRole('button', { name: 'Đăng nhập' });
    await user.click(loginBtn);

    // Login finishes: login sets admin
    await waitFor(() => {
      expect(screen.getByTestId('admin')).toHaveTextContent('Quản trị viên');
      expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
    });

    // NOW resolve the initial me() with 401
    await act(async () => {
      initialMeDeferred.resolve({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Not logged in' } }),
      });
      await new Promise((r) => setTimeout(r, 50));
    });

    // Admin MUST stay logged in, not overwritten to null
    expect(screen.getByTestId('admin')).toHaveTextContent('Quản trị viên');
    expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
  });
});
