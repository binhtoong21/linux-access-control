import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../auth/AuthProvider';
import { LoginPage } from './LoginPage';

function renderLoginPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/login']}>
          <LoginPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('submitting calls POST /api/v1/auth/login with the credentials', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/auth/me') {
        return Promise.resolve({
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Not logged in' } }),
        });
      }
      if (url === '/api/v1/auth/login' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 204,
          text: async () => '',
        });
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderLoginPage();

    const usernameInput = screen.getByLabelText('Tên đăng nhập');
    const passwordInput = screen.getByLabelText('Mật khẩu');
    const submitBtn = screen.getByRole('button', { name: 'Đăng nhập' });

    await user.type(usernameInput, 'admin_user');
    await user.type(passwordInput, 'secret_pass');
    await user.click(submitBtn);

    await waitFor(() => {
      const loginCall = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/v1/auth/login' && init?.method === 'POST',
      );
      expect(loginCall).toBeDefined();
      expect(JSON.parse(loginCall![1].body as string)).toEqual({
        username: 'admin_user',
        password: 'secret_pass',
      });
    });
  });

  it('INVALID_CREDENTIALS shows "Sai tên đăng nhập hoặc mật khẩu"', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/auth/me') {
        return Promise.resolve({
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Not logged in' } }),
        });
      }
      if (url === '/api/v1/auth/login' && init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 401,
          text: async () =>
            JSON.stringify({
              error: {
                code: 'INVALID_CREDENTIALS',
                message: 'Invalid username or password',
              },
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderLoginPage();

    const usernameInput = screen.getByLabelText('Tên đăng nhập');
    const passwordInput = screen.getByLabelText('Mật khẩu');
    const submitBtn = screen.getByRole('button', { name: 'Đăng nhập' });

    await user.type(usernameInput, 'admin_user');
    await user.type(passwordInput, 'wrong_pass');
    await user.click(submitBtn);

    expect(await screen.findByText('Sai tên đăng nhập hoặc mật khẩu')).toBeInTheDocument();
  });
});
