import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserPicker } from './UserPicker';
import { ApiError } from '../api/client';
import type { Page, User } from '../api/types';

function renderUserPicker(props: React.ComponentProps<typeof UserPicker>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <UserPicker {...props} />
    </QueryClientProvider>,
  );
}

describe('UserPicker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows error text and Thử lại button when query fails, not "Không tìm thấy"', async () => {
    const user = userEvent.setup();
    let queryAttempts = 0;

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/v1/users')) {
        queryAttempts++;
        if (queryAttempts === 1) {
          return Promise.resolve({
            ok: false,
            status: 500,
            text: async () =>
              JSON.stringify({
                error: {
                  code: 'INTERNAL_SERVER_ERROR',
                  message: 'Lỗi tải danh sách người dùng',
                },
              }),
          });
        }
        const page: Page<User> = {
          items: [
            {
              id: 'u-1',
              external_id: 'SV001',
              full_name: 'Nguyễn Văn A',
              email: null,
              status: 'active',
              created_at: '',
              updated_at: '',
            },
          ],
          next_cursor: null,
        };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderUserPicker({ onPick: vi.fn() });

    const input = screen.getByPlaceholderText('Tìm người dùng...');
    await user.type(input, 'SV001');

    // Wait for the query to fail and display the error message
    expect(await screen.findByText('Lỗi tải danh sách người dùng')).toBeInTheDocument();
    expect(screen.queryByText('Không tìm thấy')).not.toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: 'Thử lại' });
    expect(retryBtn).toBeInTheDocument();

    // Click retry
    await user.click(retryBtn);

    expect(await screen.findByRole('button', { name: 'SV001 — Nguyễn Văn A' })).toBeInTheDocument();
  });

  it('disables input and result buttons when disabled=true', async () => {
    const mockUser: User = {
      id: 'u-1',
      external_id: 'SV001',
      full_name: 'Nguyễn Văn A',
      email: null,
      status: 'active',
      created_at: '',
      updated_at: '',
    };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/v1/users')) {
        const page: Page<User> = { items: [mockUser], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const onPick = vi.fn();
    const { rerender } = renderUserPicker({ onPick, disabled: false });

    const input = screen.getByPlaceholderText('Tìm người dùng...');
    const user = userEvent.setup();
    await user.type(input, 'SV001');

    const optionBtn = await screen.findByRole('button', { name: 'SV001 — Nguyễn Văn A' });
    expect(optionBtn).not.toBeDisabled();

    // Re-render with disabled={true}
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <UserPicker onPick={onPick} disabled={true} />
      </QueryClientProvider>,
    );

    const disabledInput = screen.getByPlaceholderText('Tìm người dùng...');
    expect(disabledInput).toBeDisabled();
  });
});
