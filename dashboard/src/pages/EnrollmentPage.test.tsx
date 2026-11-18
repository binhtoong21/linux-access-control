import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EnrollmentPage } from './EnrollmentPage';
import type { EnrollmentRequest, Zone } from '../api/types';

const mockZones: Zone[] = [
  {
    id: 'z-1',
    name: 'Phòng Lab 01',
    location: 'Tầng 3 Nhà A',
    description: null,
    workstation_count: 5,
    created_at: '2026-11-10T08:00:00Z',
    updated_at: '2026-11-10T08:00:00Z',
  },
];

const mockPendingRequests: EnrollmentRequest[] = [
  {
    id: 'req-1',
    hostname: 'lab-pc-01',
    mac_address: '00:11:22:33:44:55',
    machine_id: 'mach-id-1234567890abcdef',
    status: 'pending',
    submitted_at: '2026-11-18T10:00:00Z',
    reviewed_at: null,
    duplicate_mac_detected: false,
    duplicate_of: null,
    workstation: null,
  },
  {
    id: 'req-2',
    hostname: 'lab-pc-02',
    mac_address: '00:11:22:33:44:66',
    machine_id: 'mach-id-abcdef1234567890',
    status: 'pending',
    submitted_at: '2026-11-18T10:05:00Z',
    reviewed_at: null,
    duplicate_mac_detected: false,
    duplicate_of: null,
    workstation: null,
  },
  {
    id: 'req-dup',
    hostname: 'lab-pc-dup',
    mac_address: '00:11:22:33:44:77',
    machine_id: 'mach-id-9999999999999999',
    status: 'pending',
    submitted_at: '2026-11-18T10:10:00Z',
    reviewed_at: null,
    duplicate_mac_detected: true,
    duplicate_of: {
      id: 'ws-old-1',
      mqtt_identity: 'ws-pc-old',
    },
    workstation: null,
  },
];

function renderEnrollmentPage() {
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
        <EnrollmentPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EnrollmentPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('duplicate row has no checkbox and only the reinstall action', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      if (url === '/api/v1/enrollment-requests?status=pending') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockPendingRequests),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEnrollmentPage();

    expect(await screen.findByText('lab-pc-dup')).toBeInTheDocument();
    const dupRow = screen.getByText('lab-pc-dup').closest('tr')!;

    // Checkbox should NOT exist in the duplicate row
    expect(within(dupRow).queryByRole('checkbox')).toBeNull();

    // Reinstall button must be present
    expect(
      within(dupRow).getByRole('button', { name: 'Duyệt cài lại ws-pc-old' }),
    ).toBeInTheDocument();

    // Normal "Duyệt" button must NOT be present
    expect(within(dupRow).queryByRole('button', { name: 'Duyệt' })).toBeNull();
  });

  it('reinstall sends {"mode":"reinstall"} only after confirm', async () => {
    const user = userEvent.setup();
    let postCallDetails: { url: string; body: string } | null = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      if (url === '/api/v1/enrollment-requests?status=pending') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockPendingRequests),
        });
      }
      if (url === '/api/v1/enrollment-requests/req-dup/approve' && init?.method === 'POST') {
        postCallDetails = {
          url,
          body: init.body as string,
        };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              ...mockPendingRequests[2],
              status: 'approved',
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEnrollmentPage();

    expect(await screen.findByText('lab-pc-dup')).toBeInTheDocument();
    const dupRow = screen.getByText('lab-pc-dup').closest('tr')!;
    const reinstallBtn = within(dupRow).getByRole('button', {
      name: 'Duyệt cài lại ws-pc-old',
    });

    // 1. Cancel confirm
    await user.click(reinstallBtn);
    expect(within(screen.getByRole('dialog')).getByText(
      'Duyệt cài lại máy ws-pc-old? Chứng chỉ cũ bị thu hồi; máy giữ tên, zone và lịch.')).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Hủy' }));
    expect(postCallDetails).toBeNull();

    // 2. Accept confirm
    await user.click(reinstallBtn);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Duyệt cài lại' }));

    await waitFor(() => {
      expect(postCallDetails).not.toBeNull();
    });

    expect(postCallDetails!.url).toBe('/api/v1/enrollment-requests/req-dup/approve');
    expect(JSON.parse(postCallDetails!.body)).toEqual({ mode: 'reinstall' });
    expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/v1/enrollment-requests/req-dup/approve' && init?.method === 'POST')).toHaveLength(1);
  });

  it('new approval rejects an invalid name locally and sends {"mode":"new","mqtt_identity":…,"zone_id":…}', async () => {
    const user = userEvent.setup();
    let postCallDetails: { url: string; body: string } | null = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      if (url === '/api/v1/enrollment-requests?status=pending') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockPendingRequests),
        });
      }
      if (url === '/api/v1/enrollment-requests/req-1/approve' && init?.method === 'POST') {
        postCallDetails = {
          url,
          body: init.body as string,
        };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              ...mockPendingRequests[0],
              status: 'approved',
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEnrollmentPage();

    expect(await screen.findByText('lab-pc-01')).toBeInTheDocument();
    const row1 = screen.getByText('lab-pc-01').closest('tr')!;
    const approveBtn = within(row1).getByRole('button', { name: 'Duyệt' });
    await user.click(approveBtn);

    const nameInput = screen.getByLabelText('Tên máy');
    const zoneSelect = screen.getByLabelText('Zone');
    const confirmBtn = screen.getByRole('button', { name: 'Xác nhận' });

    // Invalid name (< 3 chars or invalid characters)
    await user.clear(nameInput);
    await user.type(nameInput, 'ab');
    await user.click(confirmBtn);

    expect(
      await screen.findByText('Tên máy không đúng định dạng (cần 3-64 ký tự A-Z, a-z, 0-9, _, -).'),
    ).toBeInTheDocument();
    expect(postCallDetails).toBeNull();

    // Valid name and zone selection
    await user.clear(nameInput);
    await user.type(nameInput, 'lab-ws-01');
    await user.selectOptions(zoneSelect, 'z-1');
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(postCallDetails).not.toBeNull();
    });

    expect(postCallDetails!.url).toBe('/api/v1/enrollment-requests/req-1/approve');
    expect(JSON.parse(postCallDetails!.body)).toEqual({
      mode: 'new',
      mqtt_identity: 'lab-ws-01',
      zone_id: 'z-1',
    });
  });

  it('batch sends one request with the checked ids and shows approved/skipped', async () => {
    const user = userEvent.setup();
    let batchCallDetails: { url: string; body: string } | null = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      if (url === '/api/v1/enrollment-requests?status=pending') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockPendingRequests),
        });
      }
      if (url === '/api/v1/enrollment-requests/approve-batch' && init?.method === 'POST') {
        batchCallDetails = {
          url,
          body: init.body as string,
        };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              approved: [
                {
                  id: 'req-1',
                  mqtt_identity: 'lab-01',
                  workstation_id: 'ws-1',
                },
              ],
              skipped: [
                {
                  id: 'req-2',
                  reason: 'duplicate',
                },
              ],
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEnrollmentPage();

    expect(await screen.findByText('lab-pc-01')).toBeInTheDocument();

    const cb1 = screen.getByLabelText('Chọn lab-pc-01');
    const cb2 = screen.getByLabelText('Chọn lab-pc-02');

    await user.click(cb1);
    await user.click(cb2);

    expect(screen.getByText('Đã chọn 2 máy')).toBeInTheDocument();

    const prefixInput = screen.getByLabelText(/Tiền tố tên \*/);
    await user.type(prefixInput, 'lab-');

    const batchBtn = screen.getByRole('button', { name: 'Duyệt 2 máy' });
    await user.click(batchBtn);

    await waitFor(() => {
      expect(batchCallDetails).not.toBeNull();
    });

    expect(batchCallDetails!.url).toBe('/api/v1/enrollment-requests/approve-batch');
    expect(JSON.parse(batchCallDetails!.body)).toEqual({
      zone_id: 'z-1',
      request_ids: ['req-1', 'req-2'],
      name_prefix: 'lab-',
    });

    // Check approved list
    expect(await screen.findByText(/lab-01/)).toBeInTheDocument();
    // Check skipped list with Vietnamese reason
    expect(await screen.findByText(/trùng máy, cần duyệt cài lại/)).toBeInTheDocument();
  });

  it('reject cancelled sends nothing, reject with empty note sends {}', async () => {
    const user = userEvent.setup();
    let rejectCallDetails: { url: string; body: string } | null = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      if (url === '/api/v1/enrollment-requests?status=pending') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockPendingRequests),
        });
      }
      if (url === '/api/v1/enrollment-requests/req-1/reject' && init?.method === 'POST') {
        rejectCallDetails = {
          url,
          body: init.body as string,
        };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              ...mockPendingRequests[0],
              status: 'rejected',
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEnrollmentPage();

    expect(await screen.findByText('lab-pc-01')).toBeInTheDocument();
    const row1 = screen.getByText('lab-pc-01').closest('tr')!;
    const rejectBtn = within(row1).getByRole('button', { name: 'Từ chối' });

    // 1. Cancel dialog -> sends nothing
    await user.click(rejectBtn);
    expect(within(screen.getByRole('dialog')).getByLabelText('Lý do từ chối (không bắt buộc):')).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Hủy' }));
    expect(rejectCallDetails).toBeNull();

    // 2. Empty note dialog -> sends {}
    await user.click(rejectBtn);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Từ chối' }));

    await waitFor(() => {
      expect(rejectCallDetails).not.toBeNull();
    });

    expect(rejectCallDetails!.url).toBe('/api/v1/enrollment-requests/req-1/reject');
    expect(JSON.parse(rejectCallDetails!.body)).toEqual({});
    expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/v1/enrollment-requests/req-1/reject' && init?.method === 'POST')).toHaveLength(1);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(rejectBtn);
    await user.type(within(screen.getByRole('dialog')).getByLabelText('Lý do từ chối (không bắt buộc):'), '  Sai phòng  ');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Từ chối' }));
    await waitFor(() => expect(JSON.parse(rejectCallDetails!.body)).toEqual({ note: 'Sai phòng' }));
    expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/v1/enrollment-requests/req-1/reject' && init?.method === 'POST')).toHaveLength(2);
  });

  it('DUPLICATE_REQUIRES_REINSTALL shows its message', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      if (url === '/api/v1/enrollment-requests?status=pending') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockPendingRequests),
        });
      }
      if (url === '/api/v1/enrollment-requests/req-1/approve' && init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 409,
          text: async () =>
            JSON.stringify({
              error: {
                code: 'DUPLICATE_REQUIRES_REINSTALL',
                message: 'Duplicate requires reinstall',
              },
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEnrollmentPage();

    expect(await screen.findByText('lab-pc-01')).toBeInTheDocument();
    const row1 = screen.getByText('lab-pc-01').closest('tr')!;
    const approveBtn = within(row1).getByRole('button', { name: 'Duyệt' });
    await user.click(approveBtn);

    const nameInput = screen.getByLabelText('Tên máy');
    const confirmBtn = screen.getByRole('button', { name: 'Xác nhận' });

    await user.clear(nameInput);
    await user.type(nameInput, 'lab-ws-01');
    await user.click(confirmBtn);

    expect(
      await screen.findByText(
        'Yêu cầu này trùng một máy đã có: chỉ duyệt được thành cài lại máy đó.',
      ),
    ).toBeInTheDocument();
  });
});
