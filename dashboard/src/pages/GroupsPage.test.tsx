import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GroupsPage } from './GroupsPage';
import type { Group } from '../api/types';

const mockGroups: Group[] = [
  {
    id: 'g-1',
    name: 'Nhóm Lớp 01',
    description: 'Sinh viên lớp 01',
    member_count: 25,
    created_at: '2026-11-10T08:00:00Z',
    updated_at: '2026-11-10T08:00:00Z',
  },
  {
    id: 'g-2',
    name: 'Nhóm Lớp 02',
    description: null,
    member_count: 0,
    created_at: '2026-11-11T09:00:00Z',
    updated_at: '2026-11-11T09:00:00Z',
  },
];

function renderGroupsPage() {
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
        <GroupsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GroupsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists groups with member counts', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/groups') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockGroups),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderGroupsPage();

    expect(await screen.findByText('Nhóm Lớp 01')).toBeInTheDocument();
    const row1 = screen.getByText('Nhóm Lớp 01').closest('tr')!;
    expect(within(row1).getByText('Sinh viên lớp 01')).toBeInTheDocument();
    expect(within(row1).getByText('25')).toBeInTheDocument();

    expect(screen.getByText('Nhóm Lớp 02')).toBeInTheDocument();
    const row2 = screen.getByText('Nhóm Lớp 02').closest('tr')!;
    expect(within(row2).getByText('—')).toBeInTheDocument();
    expect(within(row2).getByText('0')).toBeInTheDocument();
  });

  it('create sends POST /api/v1/groups', async () => {
    const user = userEvent.setup();
    let postCallDetails: { url: string; headers: HeadersInit; body: string } | null = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/groups' && init?.method === 'POST') {
        postCallDetails = {
          url,
          headers: init.headers as HeadersInit,
          body: init.body as string,
        };
        const newGroup: Group = {
          id: 'g-3',
          name: 'Nhóm Lớp 03',
          description: 'Mô tả lớp 03',
          member_count: 0,
          created_at: '2026-11-12T10:00:00Z',
          updated_at: '2026-11-12T10:00:00Z',
        };
        return Promise.resolve({
          ok: true,
          status: 201,
          text: async () => JSON.stringify(newGroup),
        });
      }
      if (url === '/api/v1/groups') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockGroups),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderGroupsPage();

    await screen.findByText('Nhóm Lớp 01');

    const nameInput = screen.getByLabelText(/Tên \*/);
    const descInput = screen.getByLabelText(/Mô tả/);

    await user.type(nameInput, 'Nhóm Lớp 03');
    await user.type(descInput, 'Mô tả lớp 03');

    const submitBtn = screen.getByRole('button', { name: 'Thêm nhóm' });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(postCallDetails).not.toBeNull();
    });

    expect(postCallDetails!.url).toBe('/api/v1/groups');
    const headers = postCallDetails!.headers as Record<string, string>;
    expect(headers['X-Requested-With']).toBe('dashboard');
    expect(JSON.parse(postCallDetails!.body)).toEqual({
      name: 'Nhóm Lớp 03',
      description: 'Mô tả lớp 03',
    });
    expect(nameInput).toHaveValue('');
    expect(descInput).toHaveValue('');
  });

  it('DUPLICATE shows the message and keeps input', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/groups' && init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 409,
          text: async () =>
            JSON.stringify({
              error: {
                code: 'DUPLICATE',
                message: 'Group already exists',
              },
            }),
        });
      }
      if (url === '/api/v1/groups') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockGroups),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderGroupsPage();

    await screen.findByText('Nhóm Lớp 01');

    const nameInput = screen.getByLabelText(/Tên \*/);
    const descInput = screen.getByLabelText(/Mô tả/);

    await user.type(nameInput, 'Nhóm Lớp 01');
    await user.type(descInput, 'Mô tả trùng');

    const submitBtn = screen.getByRole('button', { name: 'Thêm nhóm' });
    await user.click(submitBtn);

    expect(await screen.findByText('Đã tồn tại (trùng mã hoặc tên).')).toBeInTheDocument();
    expect(nameInput).toHaveValue('Nhóm Lớp 01');
    expect(descInput).toHaveValue('Mô tả trùng');
  });
});
