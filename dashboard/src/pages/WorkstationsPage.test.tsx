import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkstationsPage } from './WorkstationsPage';
import type { WorkstationSummary } from '../api/types';


const mockWorkstations: WorkstationSummary[] = [
  {
    id: 'ws-1',
    mqtt_identity: 'ws-01',
    hostname: 'lab-a-01',
    zone: { id: 'z-1', name: 'Lab A' },
    status: 'enrolled',
    connectivity: 'online',
    last_heartbeat_at: '2026-11-11T09:30:12Z',
    trust_state: 'Fresh',
    clock_skew_detected: false,
    sync: { state: 'stuck', desired_version: 15, acked_version: 10 },
    current_session: {
      user: { external_id: 'SV001', full_name: 'Nguyễn Văn A' },
      started_at: '2026-11-11T08:00:00Z',
      expires_at: '2026-11-11T10:00:00Z',
    },
    flags: ['stuck_sync'],
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

function renderWorkstationsPage() {
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
        <WorkstationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WorkstationsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders two rows from a mocked list and shows Vietnamese labels', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstations),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWorkstationsPage();

    // Verify row 1 (online, zone Lab A, current session, stuck sync flag)
    const hostLink1 = await screen.findByRole('link', { name: 'lab-a-01' });
    expect(hostLink1).toHaveAttribute('href', '/workstations/ws-1');
    expect(screen.getByText('ws-01')).toBeInTheDocument();
    expect(screen.getByText('Lab A')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    const row1 = hostLink1.closest('tr')!;
    expect(within(row1).getByText('Sẵn sàng')).toBeInTheDocument();
    expect(screen.getByText(/Nguyễn Văn A \(SV001\)/)).toBeInTheDocument();
    expect(screen.getByText(/Kẹt \(10\/15\)/)).toBeInTheDocument();
    expect(screen.getByText('Kẹt đồng bộ')).toBeInTheDocument();

    // Verify row 2 (offline, zone null, no session, in_sync)
    const hostLink2 = screen.getByRole('link', { name: 'lab-b-02' });
    expect(hostLink2).toHaveAttribute('href', '/workstations/ws-2');
    const row2 = hostLink2.closest('tr')!;
    expect(within(row2).getByText('ws-02')).toBeInTheDocument();
    expect(within(row2).getByText('Offline')).toBeInTheDocument();
    expect(within(row2).getByText('Chưa có dữ liệu')).toBeInTheDocument();
    expect(within(row2).getByText('Đã đồng bộ')).toBeInTheDocument();
  });

  it('renders readiness badges and tooltips for all states', async () => {
    const now = Date.now();
    const items: WorkstationSummary[] = [
      {
        ...mockWorkstations[0],
        id: 'ws-ready',
        hostname: 'ws-ready',
        connectivity: 'online',
        trust_state: 'Fresh',
        last_heartbeat_at: new Date(now - 60000).toISOString(),
      },
      {
        ...mockWorkstations[0],
        id: 'ws-offline-ok',
        hostname: 'ws-offline-ok',
        connectivity: 'offline',
        trust_state: 'Fresh',
        last_heartbeat_at: new Date(now - 3600000).toISOString(),
        sync: { state: 'in_sync', desired_version: 15, acked_version: 15 },
        flags: [],
      },
      {
        ...mockWorkstations[0],
        id: 'ws-offline-unknown',
        hostname: 'ws-offline-unknown',
        connectivity: 'offline',
        trust_state: 'Fresh',
        last_heartbeat_at: new Date(now - 3600000).toISOString(),
      },
      {
        ...mockWorkstations[0],
        id: 'ws-expired',
        hostname: 'ws-expired',
        connectivity: 'offline',
        trust_state: 'Expired',
        last_heartbeat_at: new Date(now - 2 * 86400000).toISOString(),
      },
      {
        ...mockWorkstations[0],
        id: 'ws-clock',
        hostname: 'ws-clock',
        connectivity: 'online',
        trust_state: 'ClockInvalid',
      },
      {
        ...mockWorkstations[0],
        id: 'ws-disabled',
        hostname: 'ws-disabled',
        status: 'disabled',
        connectivity: 'online',
      },
    ];

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(items),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWorkstationsPage();

    expect(await screen.findByText('ws-ready')).toBeInTheDocument();

    expect(screen.getByText('Offline, không rõ')).toBeInTheDocument();
    const okBadge = screen.getByText('Offline, còn dữ liệu');
    expect(okBadge).toHaveAttribute(
      'title',
      'Máy vẫn cho quẹt thẻ theo dữ liệu đã nhận đến khi hết hạn tin cậy',
    );

    const expiredBadge = screen.getByText('Hết hạn tin cậy');
    expect(expiredBadge).toHaveAttribute(
      'title',
      'Máy sẽ từ chối quẹt thẻ cho đến khi kết nối lại server. Bật máy trước giờ sử dụng.',
    );

    expect(screen.getByText('Đồng hồ sai')).toBeInTheDocument();
    expect(screen.getByText('Đã vô hiệu hóa')).toBeInTheDocument();
  });

  it('changing the filter to "Offline" requests /api/v1/workstations?connectivity=offline', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([]),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWorkstationsPage();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/workstations', expect.anything());
    });

    const filterSelect = screen.getByLabelText(/Kết nối/i);
    await user.selectOptions(filterSelect, 'offline');

    await waitFor(() => {
      const offlineCall = fetchMock.mock.calls.find(
        ([url]) => url === '/api/v1/workstations?connectivity=offline',
      );
      expect(offlineCall).toBeDefined();
    });
  });
});
