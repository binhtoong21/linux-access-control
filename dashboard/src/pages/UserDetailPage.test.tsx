import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserDetailPage } from './UserDetailPage';
import type { Card, CardDetail, UserDetail } from '../api/types';

const mockUserDetail: UserDetail = {
  id: 'u-1',
  external_id: 'SV001',
  full_name: 'Nguyễn Văn A',
  email: 'nva@example.com',
  status: 'active',
  created_at: '2026-11-11T09:30:12Z',
  updated_at: '2026-11-11T09:30:12Z',
  cards: [
    {
      id: 'c-1',
      status: 'active',
      uid_length: 7,
      created_at: '2026-11-11T09:30:12Z',
    },
  ],
  groups: [
    {
      id: 'g-1',
      name: 'Nhóm Lớp 01',
    },
  ],
};

function renderUserDetailPage(userId = 'u-1') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/users/${userId}`]}>
        <Routes>
          <Route path="/users/:id" element={<UserDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('UserDetailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows user, cards and groups', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/users/u-1') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockUserDetail),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderUserDetailPage();

    expect(await screen.findByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(screen.getByText('Mã: SV001')).toBeInTheDocument();
    expect(screen.getByText('nva@example.com')).toBeInTheDocument();
    expect(screen.getByText('Thẻ 7 byte')).toBeInTheDocument();
    expect(screen.getByText('Nhóm Lớp 01')).toBeInTheDocument();
  });

  it('Khóa sends POST /api/v1/cards/{id}/disable', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/users/u-1') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockUserDetail),
        });
      }
      if (url === '/api/v1/cards/c-1/disable' && init?.method === 'POST') {
        const disabledCard: Card = {
          id: 'c-1',
          status: 'disabled',
          uid_length: 7,
          owner: { id: 'u-1', external_id: 'SV001', full_name: 'Nguyễn Văn A' },
          created_at: '2026-11-11T09:30:12Z',
          updated_at: '2026-11-11T09:30:12Z',
        };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(disabledCard),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderUserDetailPage();

    const disableBtn = await screen.findByRole('button', { name: 'Khóa' });
    await user.click(disableBtn);

    await waitFor(() => {
      const disableCall = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/v1/cards/c-1/disable' && init?.method === 'POST',
      );
      expect(disableCall).toBeDefined();
    });
  });

  it('registering UID 04 a3:2b 1c 5d 6e 80 sends {"uid":"04A32B1C5D6E80","user_id":...}', async () => {
    const user = userEvent.setup();
    let registerCallBody: unknown = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/users/u-1') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockUserDetail),
        });
      }
      if (url === '/api/v1/cards' && init?.method === 'POST') {
        registerCallBody = JSON.parse(init.body as string);
        const card: Card = {
          id: 'c-2',
          status: 'active',
          uid_length: 7,
          owner: { id: 'u-1', external_id: 'SV001', full_name: 'Nguyễn Văn A' },
          created_at: '2026-11-11T09:30:12Z',
          updated_at: '2026-11-11T09:30:12Z',
        };
        return Promise.resolve({
          ok: true,
          status: 201,
          text: async () => JSON.stringify(card),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderUserDetailPage();

    const input = await screen.findByRole('textbox', { name: /uid/i });
    await user.type(input, '04 a3:2b 1c 5d 6e 80');

    const submitBtn = screen.getByRole('button', { name: 'Đăng ký thẻ' });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(registerCallBody).toEqual({
        uid: '04A32B1C5D6E80',
        user_id: 'u-1',
      });
    });
  });

  it('RANDOM_UID_NOT_SUPPORTED shows its message', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/users/u-1') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockUserDetail),
        });
      }
      if (url === '/api/v1/cards' && init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({
              error: {
                code: 'RANDOM_UID_NOT_SUPPORTED',
                message: 'Random UID not allowed',
              },
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderUserDetailPage();

    const input = await screen.findByRole('textbox', { name: /uid/i });
    await user.type(input, '08 11 22 33');

    const submitBtn = screen.getByRole('button', { name: 'Đăng ký thẻ' });
    await user.click(submitBtn);

    expect(
      await screen.findByText(
        'Thẻ dùng UID ngẫu nhiên (ví dụ CCCD, điện thoại), không dùng được để đăng nhập.',
      ),
    ).toBeInTheDocument();
  });

  it('Xem UID shows the UID returned by GET /cards/{id}', async () => {
    const user = userEvent.setup();
    const mockCardDetail: CardDetail = {
      id: 'c-1',
      status: 'active',
      uid_length: 7,
      owner: { id: 'u-1', external_id: 'SV001', full_name: 'Nguyễn Văn A' },
      uid: '04A32B1C5D6E80',
      created_at: '2026-11-11T09:30:12Z',
      updated_at: '2026-11-11T09:30:12Z',
    };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/users/u-1') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockUserDetail),
        });
      }
      if (url === '/api/v1/cards/c-1') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockCardDetail),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderUserDetailPage();

    const viewUidBtn = await screen.findByRole('button', { name: 'Xem UID' });
    await user.click(viewUidBtn);

    expect(await screen.findByText('04A32B1C5D6E80')).toBeInTheDocument();
  });

  it('deactivate sends nothing when window.confirm returns false', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/users/u-1') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockUserDetail),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderUserDetailPage();

    const deactivateBtn = await screen.findByRole('button', { name: 'Vô hiệu hóa' });
    await user.click(deactivateBtn);

    expect(confirmSpy).toHaveBeenCalled();
    const deactivateCalls = fetchMock.mock.calls.filter(
      ([url]) => url.includes('/deactivate'),
    );
    expect(deactivateCalls).toHaveLength(0);
  });
});
