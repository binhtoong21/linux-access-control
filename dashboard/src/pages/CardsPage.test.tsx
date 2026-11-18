import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CardsPage } from './CardsPage';
import type { AuditLog, AuditLogDetail, Card, Page, User } from '../api/types';

const mockCardUnbound: Card = {
  id: 'card-ub-1',
  status: 'unbound',
  uid_length: 7,
  owner: null,
  created_at: '2026-11-10T08:00:00Z',
  updated_at: '2026-11-10T08:00:00Z',
};

const mockAuditLog: AuditLog = {
  id: 'log-1',
  entry_id: 'entry-999',
  occurred_at: '2026-11-15T14:30:00Z',
  received_at: '2026-11-15T14:30:01Z',
  outcome: 'denied',
  reason: 'unknown_card',
  detail: null,
  user: null,
  card: null,
  workstation: {
    id: 'ws-1',
    mqtt_identity: 'ws-lab-01',
    hostname: 'lab01',
    zone: null,
  },
  target_os_username: null,
  data_version: 1,
  matched_schedule_ids: [],
  has_card_uid: true,
};

const mockCandidateUser: User = {
  id: 'u-1',
  external_id: 'SV001',
  full_name: 'Nguyễn Văn A',
  email: 'nva@example.com',
  status: 'active',
  created_at: '2026-11-11T09:30:12Z',
  updated_at: '2026-11-11T09:30:12Z',
};

function renderCardsPage() {
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
        <CardsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CardsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('UID search sends uid=04A32B1C5D6E80 from input 04:a3:2b:1c:5d:6e:80', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/v1/cards')) {
        const page: Page<Card> = { items: [], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      if (url.startsWith('/api/v1/audit-logs')) {
        const page: Page<AuditLog> = { items: [], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderCardsPage();

    const uidInput = screen.getByPlaceholderText(/Nhập UID/);
    await user.type(uidInput, '04:a3:2b:1c:5d:6e:80');

    await waitFor(
      () => {
        const matchingCall = fetchMock.mock.calls.find(([url]) =>
          url.includes('uid=04A32B1C5D6E80'),
        );
        expect(matchingCall).toBeDefined();
      },
      { timeout: 2000 },
    );
  });

  it('unknown-card row -> pick user -> POST /api/v1/cards body {"from_audit_entry_id": <entry_id>, "user_id": ...}', async () => {
    const user = userEvent.setup();
    let registerCardBody: unknown = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/v1/cards') && init?.method === 'POST') {
        registerCardBody = JSON.parse(init.body as string);
        const newCard: Card = {
          id: 'card-new-1',
          status: 'active',
          uid_length: 7,
          owner: { id: 'u-1', external_id: 'SV001', full_name: 'Nguyễn Văn A' },
          created_at: '2026-11-15T15:00:00Z',
          updated_at: '2026-11-15T15:00:00Z',
        };
        return Promise.resolve({
          ok: true,
          status: 201,
          text: async () => JSON.stringify(newCard),
        });
      }
      if (url.startsWith('/api/v1/cards')) {
        const page: Page<Card> = { items: [], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      if (url.startsWith('/api/v1/audit-logs')) {
        const page: Page<AuditLog> = { items: [mockAuditLog], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      if (url.startsWith('/api/v1/users')) {
        const page: Page<User> = { items: [mockCandidateUser], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderCardsPage();

    expect(await screen.findByText('ws-lab-01')).toBeInTheDocument();

    const assignBtn = screen.getByRole('button', { name: 'Gắn cho người dùng…' });
    await user.click(assignBtn);

    const userPickerInput = await screen.findByPlaceholderText('Tìm người dùng...');
    await user.type(userPickerInput, 'SV001');

    const pickUserBtn = await screen.findByRole('button', {
      name: 'SV001 — Nguyễn Văn A',
    });
    await user.click(pickUserBtn);

    await waitFor(() => {
      expect(registerCardBody).toEqual({
        from_audit_entry_id: 'entry-999',
        user_id: 'u-1',
      });
    });

    expect(await screen.findByText('Đã gắn thẻ cho SV001.')).toBeInTheDocument();
  });

  it('RANDOM_UID_NOT_SUPPORTED message shown', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/v1/cards') && init?.method === 'POST') {
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
      if (url.startsWith('/api/v1/cards')) {
        const page: Page<Card> = { items: [], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      if (url.startsWith('/api/v1/audit-logs')) {
        const page: Page<AuditLog> = { items: [mockAuditLog], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      if (url.startsWith('/api/v1/users')) {
        const page: Page<User> = { items: [mockCandidateUser], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderCardsPage();

    expect(await screen.findByText('ws-lab-01')).toBeInTheDocument();

    const assignBtn = screen.getByRole('button', { name: 'Gắn cho người dùng…' });
    await user.click(assignBtn);

    const userPickerInput = await screen.findByPlaceholderText('Tìm người dùng...');
    await user.type(userPickerInput, 'SV001');

    const pickUserBtn = await screen.findByRole('button', {
      name: 'SV001 — Nguyễn Văn A',
    });
    await user.click(pickUserBtn);

    expect(
      await screen.findByText(
        'Thẻ dùng UID ngẫu nhiên (ví dụ CCCD, điện thoại), không dùng được để đăng nhập.',
      ),
    ).toBeInTheDocument();
  });

  it('Gắn cho… on an unbound card sends POST /api/v1/cards/{id}/bind', async () => {
    const user = userEvent.setup();
    let bindCallDetails: { url: string; body: unknown } | null = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/cards/card-ub-1/bind' && init?.method === 'POST') {
        bindCallDetails = {
          url,
          body: JSON.parse(init.body as string),
        };
        const boundCard: Card = {
          id: 'card-ub-1',
          status: 'active',
          uid_length: 7,
          owner: { id: 'u-1', external_id: 'SV001', full_name: 'Nguyễn Văn A' },
          created_at: '2026-11-10T08:00:00Z',
          updated_at: '2026-11-10T08:00:00Z',
        };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(boundCard),
        });
      }
      if (url.startsWith('/api/v1/cards')) {
        const page: Page<Card> = { items: [mockCardUnbound], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      if (url.startsWith('/api/v1/audit-logs')) {
        const page: Page<AuditLog> = { items: [], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      if (url.startsWith('/api/v1/users')) {
        const page: Page<User> = { items: [mockCandidateUser], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderCardsPage();

    const bindBtn = await screen.findByRole('button', { name: 'Gắn cho…' });
    await user.click(bindBtn);

    const userPickerInput = await screen.findByPlaceholderText('Tìm người dùng...');
    await user.type(userPickerInput, 'SV001');

    const pickUserBtn = await screen.findByRole('button', {
      name: 'SV001 — Nguyễn Văn A',
    });
    await user.click(pickUserBtn);

    await waitFor(() => {
      expect(bindCallDetails).not.toBeNull();
    });

    expect(bindCallDetails!.url).toBe('/api/v1/cards/card-ub-1/bind');
    expect(bindCallDetails!.body).toEqual({
      user_id: 'u-1',
    });
    expect(await screen.findByText('Đã gắn thẻ cho SV001.')).toBeInTheDocument();
  });

  it('Xem UID on unknown-card row fetches getAuditLog and displays UID inline', async () => {
    const user = userEvent.setup();

    const mockDetail: AuditLogDetail = {
      ...mockAuditLog,
      card_uid: '04A32B1C5D6E80',
      reader_raw: null,
    };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/audit-logs/log-1') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockDetail),
        });
      }
      if (url.startsWith('/api/v1/cards')) {
        const page: Page<Card> = { items: [], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      if (url.startsWith('/api/v1/audit-logs')) {
        const page: Page<AuditLog> = { items: [mockAuditLog], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderCardsPage();

    const viewUidBtn = await screen.findByRole('button', { name: 'Xem UID' });
    await user.click(viewUidBtn);

    expect(await screen.findByText('04A32B1C5D6E80')).toBeInTheDocument();
  });

  it('prevents double register while a request is in-flight', async () => {
    const user = userEvent.setup();
    let resolvePost: ((value: unknown) => void) | null = null;
    let postCalls = 0;

    const candidate2: User = {
      id: 'u-2',
      external_id: 'SV002',
      full_name: 'Trần Thị B',
      email: null,
      status: 'active',
      created_at: '',
      updated_at: '',
    };

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/v1/cards') && init?.method === 'POST') {
        postCalls++;
        return new Promise((resolve) => {
          resolvePost = () => {
            resolve({
              ok: true,
              status: 201,
              text: async () =>
                JSON.stringify({
                  id: 'card-new-1',
                  status: 'active',
                  uid_length: 7,
                  owner: { id: 'u-1', external_id: 'SV001', full_name: 'Nguyễn Văn A' },
                  created_at: '',
                  updated_at: '',
                }),
            });
          };
        });
      }
      if (url.startsWith('/api/v1/cards')) {
        const page: Page<Card> = { items: [], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      if (url.startsWith('/api/v1/audit-logs')) {
        const page: Page<AuditLog> = { items: [mockAuditLog], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      if (url.startsWith('/api/v1/users')) {
        const page: Page<User> = { items: [mockCandidateUser, candidate2], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderCardsPage();

    expect(await screen.findByText('ws-lab-01')).toBeInTheDocument();

    const assignBtn = screen.getByRole('button', { name: 'Gắn cho người dùng…' });
    await user.click(assignBtn);

    const userPickerInput = await screen.findByPlaceholderText('Tìm người dùng...');
    await user.type(userPickerInput, 'SV');

    const pickUser1 = await screen.findByRole('button', { name: 'SV001 — Nguyễn Văn A' });
    const pickUser2 = await screen.findByRole('button', { name: 'SV002 — Trần Thị B' });

    // Pick first user -> starts in-flight POST
    await user.click(pickUser1);
    expect(postCalls).toBe(1);

    // Try to pick second user while in-flight -> ignored / disabled
    await user.click(pickUser2);
    expect(postCalls).toBe(1);

    // Release promise
    resolvePost!({});
    await waitFor(() => {
      expect(screen.getByText('Đã gắn thẻ cho SV001.')).toBeInTheDocument();
    });

    expect(postCalls).toBe(1);
  });
});
