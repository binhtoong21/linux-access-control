import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GroupDetailPage } from './GroupDetailPage';
import type { Group, Page, User } from '../api/types';

const mockGroups: Group[] = [
  {
    id: 'g-1',
    name: 'Nhóm Lớp 01',
    description: 'Sinh viên lớp 01',
    member_count: 2,
    created_at: '2026-11-10T08:00:00Z',
    updated_at: '2026-11-10T08:00:00Z',
  },
];

const mockMembers: User[] = [
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

function renderGroupDetailPage(groupId = 'g-1') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/groups/${groupId}`]}>
        <Routes>
          <Route path="/groups" element={<div>Danh sách nhóm</div>} />
          <Route path="/groups/:id" element={<GroupDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GroupDetailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows members', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/groups') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockGroups),
        });
      }
      if (url === '/api/v1/groups/g-1/members') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockMembers),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderGroupDetailPage();

    expect(await screen.findByText('Nhóm Lớp 01')).toBeInTheDocument();
    expect(screen.getByText('Sinh viên lớp 01')).toBeInTheDocument();
    expect(screen.getByText('SV001')).toBeInTheDocument();
    expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(screen.getByText('SV002')).toBeInTheDocument();
    expect(screen.getByText('Trần Thị B')).toBeInTheDocument();
  });

  it('adding two picked users sends ONE PUT /api/v1/groups/{id}/members with both ids', async () => {
    const user = userEvent.setup();
    let putCallDetails: { url: string; body: unknown } | null = null;

    const candidate1: User = {
      id: 'u-3',
      external_id: 'SV003',
      full_name: 'Lê Văn C',
      email: null,
      status: 'active',
      created_at: '2026-11-13T00:00:00Z',
      updated_at: '2026-11-13T00:00:00Z',
    };
    const candidate2: User = {
      id: 'u-4',
      external_id: 'SV004',
      full_name: 'Phạm Thị D',
      email: null,
      status: 'active',
      created_at: '2026-11-13T00:00:00Z',
      updated_at: '2026-11-13T00:00:00Z',
    };

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/groups') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockGroups),
        });
      }
      if (url === '/api/v1/groups/g-1/members' && (!init || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockMembers),
        });
      }
      if (url === '/api/v1/groups/g-1/members' && init?.method === 'PUT') {
        putCallDetails = {
          url,
          body: JSON.parse(init.body as string),
        };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ added: ['u-3', 'u-4'] }),
        });
      }
      if (url.startsWith('/api/v1/users')) {
        const page: Page<User> = {
          items: [candidate1, candidate2],
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

    renderGroupDetailPage();

    await screen.findByText('Nhóm Lớp 01');

    const pickerInput = screen.getByPlaceholderText('Tìm người dùng để thêm...');

    // Pick user 3
    await user.type(pickerInput, 'SV003');
    const pickOption1 = await screen.findByRole('button', {
      name: 'SV003 — Lê Văn C',
    });
    await user.click(pickOption1);

    // Pick user 4
    await user.type(pickerInput, 'SV004');
    const pickOption2 = await screen.findByRole('button', {
      name: 'SV004 — Phạm Thị D',
    });
    await user.click(pickOption2);

    const submitAddBtn = await screen.findByRole('button', {
      name: 'Thêm 2 người',
    });
    await user.click(submitAddBtn);

    await waitFor(() => {
      expect(putCallDetails).not.toBeNull();
    });

    expect(putCallDetails!.url).toBe('/api/v1/groups/g-1/members');
    expect(putCallDetails!.body).toEqual({
      user_ids: ['u-3', 'u-4'],
    });

    expect(await screen.findByText('Đã thêm 2 người')).toBeInTheDocument();
  });

  it('delete with REFERENCED_BY_SCHEDULE shows the message and stays', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/groups') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockGroups),
        });
      }
      if (url === '/api/v1/groups/g-1/members') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockMembers),
        });
      }
      if (url === '/api/v1/groups/g-1' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: false,
          status: 409,
          text: async () =>
            JSON.stringify({
              error: {
                code: 'REFERENCED_BY_SCHEDULE',
                message: 'Referenced by schedule',
              },
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderGroupDetailPage();

    await screen.findByText('Nhóm Lớp 01');

    const deleteBtn = screen.getByRole('button', { name: 'Xóa nhóm' });
    await user.click(deleteBtn);

    expect(
      await screen.findByText(
        'Đang được lịch sử dụng, không xóa được. Sửa hoặc xóa lịch trước.',
      ),
    ).toBeInTheDocument();

    // Verify stays on the page
    expect(screen.getByText('Nhóm Lớp 01')).toBeInTheDocument();
  });

  it('remove member sends DELETE .../members/{user_id} only after confirm', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm');

    let deleteCallDetails: string | null = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/groups') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockGroups),
        });
      }
      if (url === '/api/v1/groups/g-1/members') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockMembers),
        });
      }
      if (url.startsWith('/api/v1/groups/g-1/members/') && init?.method === 'DELETE') {
        deleteCallDetails = url;
        return Promise.resolve({
          ok: true,
          status: 204,
          text: async () => '',
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderGroupDetailPage();

    await screen.findByText('Nhóm Lớp 01');
    const removeButtons = await screen.findAllByRole('button', { name: 'Bỏ khỏi nhóm' });
    expect(removeButtons).toHaveLength(2);

    // First attempt: confirm = false
    confirmSpy.mockReturnValueOnce(false);
    await user.click(removeButtons[0]);

    expect(deleteCallDetails).toBeNull();

    // Second attempt: confirm = true
    confirmSpy.mockReturnValueOnce(true);
    await user.click(removeButtons[0]);

    await waitFor(() => {
      expect(deleteCallDetails).toBe('/api/v1/groups/g-1/members/u-1');
    });
  });

  it('adding members when server returns added: [] shows "Những người này đã có trong nhóm."', async () => {
    const user = userEvent.setup();
    const candidate1: User = {
      id: 'u-3',
      external_id: 'SV003',
      full_name: 'Lê Văn C',
      email: null,
      status: 'active',
      created_at: '2026-11-13T00:00:00Z',
      updated_at: '2026-11-13T00:00:00Z',
    };

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/groups') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockGroups),
        });
      }
      if (url === '/api/v1/groups/g-1/members' && (!init || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockMembers),
        });
      }
      if (url === '/api/v1/groups/g-1/members' && init?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ added: [] }),
        });
      }
      if (url.startsWith('/api/v1/users')) {
        const page: Page<User> = {
          items: [candidate1],
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

    renderGroupDetailPage();

    await screen.findByText('Nhóm Lớp 01');

    const pickerInput = screen.getByPlaceholderText('Tìm người dùng để thêm...');
    await user.type(pickerInput, 'SV003');

    const pickOption = await screen.findByRole('button', {
      name: 'SV003 — Lê Văn C',
    });
    await user.click(pickOption);

    const submitAddBtn = await screen.findByRole('button', {
      name: 'Thêm 1 người',
    });
    await user.click(submitAddBtn);

    expect(
      await screen.findByText('Những người này đã có trong nhóm.'),
    ).toBeInTheDocument();
  });
});
