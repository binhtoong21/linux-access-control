import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IssuesPage } from './IssuesPage';
import type { IngestReject, WorkstationAlert, WorkstationSummary } from '../api/types';

const mockWorkstations: WorkstationSummary[] = [
  {
    id: 'ws-1',
    mqtt_identity: 'ws-01',
    hostname: 'lab-a-01',
    zone: { id: 'z-1', name: 'Lab A' },
    status: 'enrolled',
    connectivity: 'online',
    last_heartbeat_at: '2026-11-18T10:00:00Z',
    trust_state: 'Fresh',
    clock_skew_detected: false,
    sync: { state: 'in_sync', desired_version: 1, acked_version: 1 },
    current_session: null,
    flags: [],
  },
  {
    id: 'ws-2',
    mqtt_identity: 'ws-02',
    hostname: 'lab-b-02',
    zone: null,
    status: 'enrolled',
    connectivity: 'offline',
    last_heartbeat_at: null,
    trust_state: null,
    clock_skew_detected: false,
    sync: { state: 'in_sync', desired_version: 0, acked_version: 0 },
    current_session: null,
    flags: [],
  },
];

const mockUnresolvedReject: IngestReject = {
  id: 'rej-1',
  entry_id: 'entry-1',
  raw_record: { event: 'scan', uid: '[redacted]' },
  error: 'Invalid schema error',
  received_at: '2026-11-18T08:30:00Z',
  resolved_at: null,
  resolved_by: null,
  note: null,
  workstation: { id: 'ws-1', mqtt_identity: 'ws-01' },
};

const mockResolvedReject: IngestReject = {
  id: 'rej-2',
  entry_id: 'entry-2',
  raw_record: { event: 'heartbeat', info: 123 },
  error: 'Payload malformed',
  received_at: '2026-11-18T07:15:00Z',
  resolved_at: '2026-11-18T09:00:00Z',
  resolved_by: 'admin-1',
  note: 'Đã kiểm tra và xử lý',
  workstation: { id: 'ws-1', mqtt_identity: 'ws-01' },
};

const mockAlerts: WorkstationAlert[] = [
  {
    id: 'alt-1',
    entry_id: 'alert-entry-1',
    kind: 'snapshot_signature_invalid',
    detail: { key_id: 'k-1', failure: 'bad_signature' },
    occurred_at: '2026-11-18T08:00:00Z',
    received_at: '2026-11-18T08:00:05Z',
    workstation: { id: 'ws-1', mqtt_identity: 'ws-01' },
  },
  {
    id: 'alt-2',
    entry_id: 'alert-entry-2',
    kind: 'edge_db_recovered',
    detail: { corrupted_tables: ['leases'] },
    occurred_at: '2026-11-18T08:15:00Z',
    received_at: '2026-11-18T08:15:03Z',
    workstation: { id: 'ws-2', mqtt_identity: 'ws-02' },
  },
];

function renderIssuesPage(initialUrl = '/issues') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <Routes>
          <Route path="/issues" element={<IssuesPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('IssuesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('unresolved list by default (resolved=false) and renders sections', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstations),
        });
      }
      if (url.startsWith('/api/v1/ingest-rejects')) {
        expect(url).toContain('resolved=false');
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: [mockUnresolvedReject], next_cursor: null }),
        });
      }
      if (url.startsWith('/api/v1/workstation-alerts')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: mockAlerts, next_cursor: null }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderIssuesPage();

    expect(await screen.findByText('Sự cố')).toBeInTheDocument();
    expect(
      screen.getByText('Bản ghi máy gửi lên nhưng không lưu được'),
    ).toBeInTheDocument();
    expect(screen.getByText('Cảnh báo từ máy')).toBeInTheDocument();

    // Verify unresolved row is rendered
    expect(await screen.findByText('Invalid schema error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đánh dấu đã xem' })).toBeInTheDocument();
  });

  it('?workstation_id= passed through to both queries and initializes select', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstations),
        });
      }
      if (url.startsWith('/api/v1/ingest-rejects')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: [], next_cursor: null }),
        });
      }
      if (url.startsWith('/api/v1/workstation-alerts')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: [], next_cursor: null }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderIssuesPage('/issues?workstation_id=ws-1');

    await waitFor(() => {
      const rejectCalls = fetchMock.mock.calls.filter(([u]) =>
        u.startsWith('/api/v1/ingest-rejects'),
      );
      expect(rejectCalls.length).toBeGreaterThan(0);
      expect(rejectCalls[0][0]).toContain('workstation_id=ws-1');
      expect(rejectCalls[0][0]).toContain('resolved=false');

      const alertCalls = fetchMock.mock.calls.filter(([u]) =>
        u.startsWith('/api/v1/workstation-alerts'),
      );
      expect(alertCalls.length).toBeGreaterThan(0);
      expect(alertCalls[0][0]).toContain('workstation_id=ws-1');
    });

    const select = await screen.findByLabelText('Chọn máy');
    expect(select).toHaveValue('ws-1');
  });

  it('resolve cancelled sends nothing', async () => {
    const user = userEvent.setup();
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstations),
        });
      }
      if (url.startsWith('/api/v1/ingest-rejects')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: [mockUnresolvedReject], next_cursor: null }),
        });
      }
      if (url.startsWith('/api/v1/workstation-alerts')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: [], next_cursor: null }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderIssuesPage();

    const markBtn = await screen.findByRole('button', { name: 'Đánh dấu đã xem' });
    await user.click(markBtn);

    expect(promptSpy).toHaveBeenCalledWith('Ghi chú (không bắt buộc):');

    const resolveCalls = fetchMock.mock.calls.filter(([u]) =>
      u.includes('/resolve'),
    );
    expect(resolveCalls).toHaveLength(0);
  });

  it('resolve with a note sends {"note":"…"} once even on double click', async () => {
    const user = userEvent.setup();
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Cần cấu hình lại Agent');
    let resolveCallCount = 0;
    let resolveBody: unknown = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstations),
        });
      }
      if (url.startsWith('/api/v1/ingest-rejects') && !url.includes('/resolve')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: [mockUnresolvedReject], next_cursor: null }),
        });
      }
      if (url === '/api/v1/ingest-rejects/rej-1/resolve' && init?.method === 'POST') {
        resolveCallCount++;
        resolveBody = JSON.parse(init.body as string);
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              ...mockUnresolvedReject,
              resolved_at: '2026-11-18T10:00:00Z',
              note: 'Cần cấu hình lại Agent',
            }),
        });
      }
      if (url.startsWith('/api/v1/workstation-alerts')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: [], next_cursor: null }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderIssuesPage();

    const markBtn = await screen.findByRole('button', { name: 'Đánh dấu đã xem' });

    // Double click
    await user.dblClick(markBtn);

    await waitFor(() => {
      expect(resolveCallCount).toBe(1);
      expect(resolveBody).toEqual({ note: 'Cần cấu hình lại Agent' });
    });
  });

  it('"Đã xem" filter sends resolved=true and renders resolved text', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstations),
        });
      }
      if (url.startsWith('/api/v1/ingest-rejects')) {
        if (url.includes('resolved=true')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ items: [mockResolvedReject], next_cursor: null }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: [mockUnresolvedReject], next_cursor: null }),
        });
      }
      if (url.startsWith('/api/v1/workstation-alerts')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: [], next_cursor: null }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderIssuesPage();

    expect(await screen.findByText('Invalid schema error')).toBeInTheDocument();

    const resolvedFilterBtn = screen.getByRole('button', { name: 'Đã xem' });
    await user.click(resolvedFilterBtn);

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([u]) =>
        u.includes('resolved=true'),
      );
      expect(calls.length).toBeGreaterThan(0);
    });

    expect(await screen.findByText('Payload malformed')).toBeInTheDocument();
    expect(screen.getByText(/Đã xem lúc/)).toBeInTheDocument();
    expect(screen.getByText(/Đã kiểm tra và xử lý/)).toBeInTheDocument();
  });

  it('alerts render Vietnamese kind labels', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstations),
        });
      }
      if (url.startsWith('/api/v1/ingest-rejects')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: [], next_cursor: null }),
        });
      }
      if (url.startsWith('/api/v1/workstation-alerts')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: mockAlerts, next_cursor: null }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderIssuesPage();

    expect(
      await screen.findByText('Snapshot có chữ ký sai (bị từ chối)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('CSDL trên máy hỏng và đã dựng lại'),
    ).toBeInTheDocument();
  });

  it('raw_record JSON toggle displays and hides formatted JSON', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstations),
        });
      }
      if (url.startsWith('/api/v1/ingest-rejects')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: [mockUnresolvedReject], next_cursor: null }),
        });
      }
      if (url.startsWith('/api/v1/workstation-alerts')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: [], next_cursor: null }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderIssuesPage();

    const toggleBtn = await screen.findByRole('button', { name: 'Xem dữ liệu' });
    expect(screen.queryByText(/\[redacted\]/)).not.toBeInTheDocument();

    // Toggle open
    await user.click(toggleBtn);
    expect(await screen.findByText(/\[redacted\]/)).toBeInTheDocument();

    // Toggle closed
    const hideBtn = screen.getByRole('button', { name: 'Ẩn dữ liệu' });
    await user.click(hideBtn);
    expect(screen.queryByText(/\[redacted\]/)).not.toBeInTheDocument();
  });

  it('alert detail JSON toggle displays and hides detail JSON', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstations),
        });
      }
      if (url.startsWith('/api/v1/ingest-rejects')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: [], next_cursor: null }),
        });
      }
      if (url.startsWith('/api/v1/workstation-alerts')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: [mockAlerts[0]], next_cursor: null }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderIssuesPage();

    const detailBtn = await screen.findByRole('button', { name: 'Chi tiết' });
    expect(screen.queryByText(/bad_signature/)).not.toBeInTheDocument();

    // Open detail
    await user.click(detailBtn);
    expect(await screen.findByText(/bad_signature/)).toBeInTheDocument();

    // Close detail
    const hideDetailBtn = screen.getByRole('button', { name: 'Ẩn chi tiết' });
    await user.click(hideDetailBtn);
    expect(screen.queryByText(/bad_signature/)).not.toBeInTheDocument();
  });
});
