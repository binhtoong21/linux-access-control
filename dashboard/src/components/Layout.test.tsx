import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../auth/AuthProvider';
import { RequireAuth } from '../auth/RequireAuth';
import { Layout } from './Layout';

function renderLayoutWithAuth(initialPath = '/workstations') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
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
              <Route path="/issues" element={<div>Nội dung sự cố</div>} />
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

  it('renders sidebar navigation groups and responds to menu button, escape and item click', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/auth/me') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 'adm-1', username: 'admin', display_name: 'Quản trị viên' }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderLayoutWithAuth();

    // Verify nav groups and product name
    expect(await screen.findByText('Quản trị')).toBeInTheDocument();
    expect(screen.getAllByText('NFC Lab').length).toBeGreaterThan(0);
    expect(screen.getByText('Vận hành')).toBeInTheDocument();
    expect(screen.getByText('Danh tính')).toBeInTheDocument();
    expect(screen.getByText('Cấu hình')).toBeInTheDocument();

    // Verify navigation links
    expect(screen.getByRole('link', { name: 'Máy trạm' })).toHaveAttribute('href', '/workstations');
    expect(screen.getByRole('link', { name: 'Sự cố' })).toHaveAttribute('href', '/issues');
    expect(screen.getByRole('link', { name: 'Lịch sử' })).toHaveAttribute('href', '/history');
    expect(screen.getByRole('link', { name: 'Người dùng' })).toHaveAttribute('href', '/users');
    expect(screen.getByRole('link', { name: 'Nhóm' })).toHaveAttribute('href', '/groups');
    expect(screen.getByRole('link', { name: 'Thẻ' })).toHaveAttribute('href', '/cards');
    expect(screen.getByRole('link', { name: 'Nhập CSV' })).toHaveAttribute('href', '/import');
    expect(screen.getByRole('link', { name: 'Lịch' })).toHaveAttribute('href', '/schedules');
    expect(screen.getByRole('link', { name: 'Zone' })).toHaveAttribute('href', '/zones');
    expect(screen.getByRole('link', { name: 'Duyệt máy' })).toHaveAttribute('href', '/enrollment');

    // Menu button toggles mobile overlay
    const menuBtn = screen.getByRole('button', { name: 'Menu' });
    expect(screen.queryByTestId('sidebar-backdrop')).not.toBeInTheDocument();

    await user.click(menuBtn);
    expect(screen.getByTestId('sidebar-backdrop')).toBeInTheDocument();
    // Focus moves into the overlay and the page behind it is inert
    expect(screen.getByRole('link', { name: 'Máy trạm' })).toHaveFocus();
    expect(screen.getByRole('main')).toHaveAttribute('inert');
    // Shift+Tab from the first item wraps to the last focusable element of the sidebar
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.getByRole('button', { name: 'Đăng xuất' })).toHaveFocus();

    // Escape closes mobile overlay and returns focus to Menu
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('sidebar-backdrop')).not.toBeInTheDocument();
    expect(menuBtn).toHaveFocus();
    expect(screen.getByRole('main')).not.toHaveAttribute('inert');

    // Opening again and clicking an item closes mobile overlay and navigates
    await user.click(menuBtn);
    expect(screen.getByTestId('sidebar-backdrop')).toBeInTheDocument();

    const issuesLink = screen.getByRole('link', { name: 'Sự cố' });
    await user.click(issuesLink);
    expect(screen.queryByTestId('sidebar-backdrop')).not.toBeInTheDocument();
    expect(await screen.findByText('Nội dung sự cố')).toBeInTheDocument();
  });
});
