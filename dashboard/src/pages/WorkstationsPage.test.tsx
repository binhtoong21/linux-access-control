import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
      <WorkstationsPage />
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
    expect(await screen.findByText('lab-a-01')).toBeInTheDocument();
    expect(screen.getByText('ws-01')).toBeInTheDocument();
    expect(screen.getByText('Lab A')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText(/Nguyễn Văn A \(SV001\)/)).toBeInTheDocument();
    expect(screen.getByText(/Kẹt \(10\/15\)/)).toBeInTheDocument();
    expect(screen.getByText('Kẹt đồng bộ')).toBeInTheDocument();

    // Verify row 2 (offline, zone null, no session, in_sync)
    const row2 = screen.getByText('lab-b-02').closest('tr')!;
    expect(within(row2).getByText('ws-02')).toBeInTheDocument();
    expect(within(row2).getByText('Offline')).toBeInTheDocument();
    expect(within(row2).getByText('Đã đồng bộ')).toBeInTheDocument();
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
