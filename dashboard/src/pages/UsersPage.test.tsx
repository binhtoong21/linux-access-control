import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UsersPage } from './UsersPage';
import type { Page, User } from '../api/types';

const mockUsers: User[] = [
  {
    id: 'u-1',
    external_id: 'SV001',
    full_name: 'Nguyễn Văn A',
    email: 'nva@example.com',
    status: 'active',
    created_at: '2026-11-11T09:30:12Z',
    updated_at: '2026-11-11T09:30:12Z',
  },
  {
    id: 'u-2',
    external_id: 'SV002',
    full_name: 'Trần Thị B',
    email: null,
    status: 'inactive',
    created_at: '2026-11-12T10:00:00Z',
    updated_at: '2026-11-12T10:00:00Z',
  },
];

function renderUsersPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('UsersPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders rows from a mocked page', async () => {
    const pageData: Page<User> = {
      items: mockUsers,
      next_cursor: null,
    };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/v1/users')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(pageData),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderUsersPage();

    expect(await screen.findByText('SV001')).toBeInTheDocument();
    const row1 = screen.getByText('SV001').closest('tr')!;
    expect(within(row1).getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(within(row1).getByText('nva@example.com')).toBeInTheDocument();
    expect(within(row1).getByText('Đang hoạt động')).toBeInTheDocument();

    expect(screen.getByText('SV002')).toBeInTheDocument();
    const row2 = screen.getByText('SV002').closest('tr')!;
    expect(within(row2).getByText('Trần Thị B')).toBeInTheDocument();
    expect(within(row2).getByText('Đã vô hiệu hóa')).toBeInTheDocument();
  });

  it('Tải thêm requests cursor=', async () => {
    const user = userEvent.setup();
    const page1: Page<User> = {
      items: [mockUsers[0]],
      next_cursor: 'cursor-page-2',
    };
    const page2: Page<User> = {
      items: [mockUsers[1]],
      next_cursor: null,
    };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('cursor=cursor-page-2')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page2),
        });
      }
      if (url.startsWith('/api/v1/users')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page1),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderUsersPage();

    expect(await screen.findByText('SV001')).toBeInTheDocument();
    const loadMoreBtn = screen.getByRole('button', { name: 'Tải thêm' });
    expect(loadMoreBtn).toBeInTheDocument();

    await user.click(loadMoreBtn);

    await waitFor(() => {
      expect(screen.getByText('SV002')).toBeInTheDocument();
    });

    const cursorCall = fetchMock.mock.calls.find(([url]) =>
      url.includes('cursor=cursor-page-2'),
    );
    expect(cursorCall).toBeDefined();
  });

  it('create form rejects an invalid Mã locally without calling fetch', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/v1/users')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: [], next_cursor: null }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderUsersPage();

    await screen.findByText('Chưa có người dùng nào');

    const openCreateBtn = screen.getByRole('button', { name: 'Thêm người dùng' });
    await user.click(openCreateBtn);

    const extIdInput = screen.getByLabelText(/Mã \*/);
    const nameInput = screen.getByLabelText(/Họ tên \*/);

    await user.type(extIdInput, 'invalid mã with spaces!');
    await user.type(nameInput, 'Nguyễn Văn C');

    const saveBtn = screen.getByRole('button', { name: 'Lưu' });
    await user.click(saveBtn);

    expect(
      screen.getByText('Mã chỉ gồm chữ không dấu, số, . _ -, tối đa 32 ký tự'),
    ).toBeInTheDocument();

    // Verify fetch was only called for the initial list, not for POST /users
    const postCalls = fetchMock.mock.calls.filter(
      ([, init]) => init && init.method === 'POST',
    );
    expect(postCalls).toHaveLength(0);
  });

  it('a 409 DUPLICATE response shows the Vietnamese message and keeps the input', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/users' && init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 409,
          text: async () =>
            JSON.stringify({
              error: {
                code: 'DUPLICATE',
                message: 'User already exists',
              },
            }),
        });
      }
      if (url.startsWith('/api/v1/users')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: [], next_cursor: null }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderUsersPage();

    await screen.findByText('Chưa có người dùng nào');

    const openCreateBtn = screen.getByRole('button', { name: 'Thêm người dùng' });
    await user.click(openCreateBtn);

    const extIdInput = screen.getByLabelText(/Mã \*/);
    const nameInput = screen.getByLabelText(/Họ tên \*/);

    await user.type(extIdInput, 'SV001');
    await user.type(nameInput, 'Nguyễn Văn A');

    const saveBtn = screen.getByRole('button', { name: 'Lưu' });
    await user.click(saveBtn);

    expect(await screen.findByText('Đã tồn tại (trùng mã hoặc tên).')).toBeInTheDocument();
    expect(extIdInput).toHaveValue('SV001');
    expect(nameInput).toHaveValue('Nguyễn Văn A');
  });

  it('a successful create sends POST /api/v1/users with the X-Requested-With: dashboard header', async () => {
    const user = userEvent.setup();
    let postCallDetails: { url: string; headers: HeadersInit; body: string } | null = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/users' && init?.method === 'POST') {
        postCallDetails = {
          url,
          headers: init.headers as HeadersInit,
          body: init.body as string,
        };
        return Promise.resolve({
          ok: true,
          status: 201,
          text: async () =>
            JSON.stringify({
              id: 'u-3',
              external_id: 'SV003',
              full_name: 'Lê Văn C',
              email: null,
              status: 'active',
              created_at: '2026-11-13T00:00:00Z',
              updated_at: '2026-11-13T00:00:00Z',
            }),
        });
      }
      if (url.startsWith('/api/v1/users')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: [], next_cursor: null }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderUsersPage();

    await screen.findByText('Chưa có người dùng nào');

    const openCreateBtn = screen.getByRole('button', { name: 'Thêm người dùng' });
    await user.click(openCreateBtn);

    const extIdInput = screen.getByLabelText(/Mã \*/);
    const nameInput = screen.getByLabelText(/Họ tên \*/);

    await user.type(extIdInput, 'SV003');
    await user.type(nameInput, 'Lê Văn C');

    const saveBtn = screen.getByRole('button', { name: 'Lưu' });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(postCallDetails).not.toBeNull();
    });

    expect(postCallDetails!.url).toBe('/api/v1/users');
    const headers = postCallDetails!.headers as Record<string, string>;
    expect(headers['X-Requested-With']).toBe('dashboard');
    expect(JSON.parse(postCallDetails!.body)).toEqual({
      external_id: 'SV003',
      full_name: 'Lê Văn C',
    });
  });
});
