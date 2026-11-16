import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../auth/AuthProvider';
import { RequireAuth } from '../auth/RequireAuth';
import { Layout } from './Layout';

function renderLayoutWithAuth() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/workstations']}>
          <Routes>
            <Route path="/login" element={<div>Màn hình đăng nhập</div>} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route path="/workstations" element={<div>Nội dung máy trạm</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('Layout component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('logout POST rejected shows error text and keeps admin name', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/auth/me') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 'adm-1', username: 'admin', display_name: 'Quản trị viên' }),
        });
      }
      if (url === '/api/v1/auth/logout' && init?.method === 'POST') {
        return Promise.reject(new Error('Network failure'));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderLayoutWithAuth();

    expect(await screen.findByText('Quản trị viên')).toBeInTheDocument();

    const logoutBtn = screen.getByRole('button', { name: 'Đăng xuất' });
    await user.click(logoutBtn);

    expect(await screen.findByText('Đăng xuất không thành công, thử lại')).toBeInTheDocument();
    expect(screen.getByText('Quản trị viên')).toBeInTheDocument();
    expect(screen.getByText('Nội dung máy trạm')).toBeInTheDocument();
    expect(logoutBtn).not.toBeDisabled();
  });

  it('logout POST 204 clears session and navigates to /login', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/auth/me') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 'adm-1', username: 'admin', display_name: 'Quản trị viên' }),
        });
      }
      if (url === '/api/v1/auth/logout' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 204,
          text: async () => '',
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderLayoutWithAuth();

    expect(await screen.findByText('Quản trị viên')).toBeInTheDocument();

    const logoutBtn = screen.getByRole('button', { name: 'Đăng xuất' });
    await user.click(logoutBtn);

    expect(await screen.findByText('Màn hình đăng nhập')).toBeInTheDocument();
  });
});
