import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SchedulesPage } from './SchedulesPage';
import type { Schedule, WorkstationSummary } from '../api/types';

const mockSchedules: Schedule[] = [
  {
    id: 'sched-1',
    name: 'Lịch thực hành Mạng',
    subject: {
      type: 'group',
      id: 'g-1',
      name: 'Nhóm L01',
    },
    target: {
      type: 'zone',
      id: 'z-1',
      name: 'Phòng Lab 01',
    },
    valid_from: '2026-09-01',
    valid_to: '2027-01-15',
    days_of_week: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
    start_time: '07:30',
    end_time: '11:30',
    target_os_username: null,
    status: 'enabled',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  },
  {
    id: 'sched-2',
    name: 'Lịch nghiên cứu SV',
    subject: {
      type: 'user',
      id: 'u-1',
      external_id: 'SV001',
      name: 'Nguyễn Văn A',
    },
    target: {
      type: 'workstation',
      id: 'ws-1',
      name: 'ws-lab01-01',
    },
    valid_from: '2026-10-01',
    valid_to: null,
    days_of_week: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    start_time: '13:00',
    end_time: '17:00',
    target_os_username: 'student',
    status: 'disabled',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  },
];

const mockWorkstations: WorkstationSummary[] = [
  {
    id: 'ws-1',
    mqtt_identity: 'ws-lab01-01',
    hostname: 'lab01-pc01',
    zone: { id: 'z-1', name: 'Phòng Lab 01' },
    status: 'active',
    connectivity: 'online',
    last_heartbeat_at: null,
    trust_state: 'Fresh',
    clock_skew_detected: false,
    sync: { state: 'in_sync', desired_version: 1, acked_version: 1 },
    current_session: null,
    flags: [],
  },
];

function renderSchedulesPage() {
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
        <SchedulesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SchedulesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders rows with Vietnamese day/subject/target labels', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/schedules') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockSchedules),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderSchedulesPage();

    expect(await screen.findByText('Lịch thực hành Mạng')).toBeInTheDocument();

    // Check row 1
    const row1 = screen.getByText('Lịch thực hành Mạng').closest('tr')!;
    expect(within(row1).getByText('Nhóm: Nhóm L01')).toBeInTheDocument();
    expect(within(row1).getByText('Zone: Phòng Lab 01')).toBeInTheDocument();
    expect(within(row1).getByText('T2, T4, T6')).toBeInTheDocument();
    expect(within(row1).getByText('07:30–11:30')).toBeInTheDocument();
    expect(within(row1).getByText('01/09/2026 – 15/01/2027')).toBeInTheDocument();
    expect(within(row1).getByText('mặc định của máy')).toBeInTheDocument();
    expect(within(row1).getByText('Đang bật')).toBeInTheDocument();
    expect(within(row1).getByRole('button', { name: 'Tắt' })).toBeInTheDocument();

    // Check row 2
    expect(screen.getByText('Lịch nghiên cứu SV')).toBeInTheDocument();
    const row2 = screen.getByText('Lịch nghiên cứu SV').closest('tr')!;
    expect(within(row2).getByText('Người: SV001 — Nguyễn Văn A')).toBeInTheDocument();
    expect(within(row2).getByText('Máy: ws-lab01-01')).toBeInTheDocument();
    expect(within(row2).getByText('T2–T6')).toBeInTheDocument();
    expect(within(row2).getByText('13:00–17:00')).toBeInTheDocument();
    expect(within(row2).getByText('từ 01/10/2026')).toBeInTheDocument();
    expect(within(row2).getByText('student')).toBeInTheDocument();
    expect(within(row2).getByText('Đã tắt')).toBeInTheDocument();
    expect(within(row2).getByRole('button', { name: 'Bật' })).toBeInTheDocument();
  });

  it('filter Máy sends workstation_id=', async () => {
    const user = userEvent.setup();
    const requestedUrls: string[] = [];

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      requestedUrls.push(url);
      if (url.startsWith('/api/v1/schedules')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockSchedules),
        });
      }
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

    renderSchedulesPage();

    await screen.findByText('Lịch thực hành Mạng');

    // Select "Máy" in "Xem theo"
    const viewBySelect = screen.getByLabelText('Xem theo');
    await user.selectOptions(viewBySelect, 'workstation');

    // Verify explanation under filter is shown
    expect(
      await screen.findByText('Gồm cả lịch gán cho zone của máy.'),
    ).toBeInTheDocument();

    // Select workstation
    const wsSelect = await screen.findByLabelText('Chọn máy');
    await user.selectOptions(wsSelect, 'ws-1');

    await waitFor(() => {
      expect(
        requestedUrls.some((u) => u.includes('/api/v1/schedules?workstation_id=ws-1')),
      ).toBe(true);
    });
  });

  it('disable sends POST …/disable', async () => {
    const user = userEvent.setup();
    let disableUrl: string | null = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/schedules/sched-1/disable' && init?.method === 'POST') {
        disableUrl = url;
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              ...mockSchedules[0],
              status: 'disabled',
            }),
        });
      }
      if (url.startsWith('/api/v1/schedules')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockSchedules),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderSchedulesPage();

    await screen.findByText('Lịch thực hành Mạng');
    const row1 = screen.getByText('Lịch thực hành Mạng').closest('tr')!;
    const disableBtn = within(row1).getByRole('button', { name: 'Tắt' });

    await user.click(disableBtn);

    await waitFor(() => {
      expect(disableUrl).toBe('/api/v1/schedules/sched-1/disable');
    });
  });

  it('delete only after confirm', async () => {
    const user = userEvent.setup();
    let deleteUrl: string | null = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/schedules/sched-1' && init?.method === 'DELETE') {
        deleteUrl = url;
        return Promise.resolve({
          ok: true,
          status: 204,
          text: async () => '',
        });
      }
      if (url.startsWith('/api/v1/schedules')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockSchedules),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderSchedulesPage();

    await screen.findByText('Lịch thực hành Mạng');
    const row1 = screen.getByText('Lịch thực hành Mạng').closest('tr')!;
    const deleteBtn = within(row1).getByRole('button', { name: 'Xóa' });

    // 1. User cancels confirm
    await user.click(deleteBtn);

    expect(within(screen.getByRole('dialog')).getByText(
      'Xóa lịch Lịch thực hành Mạng? Người dùng sẽ không vào được theo lịch này sau khi máy nhận dữ liệu mới.')).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Hủy' }));
    expect(deleteUrl).toBeNull();

    // 2. User confirms
    await user.click(deleteBtn);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xóa' }));

    await waitFor(() => {
      expect(deleteUrl).toBe('/api/v1/schedules/sched-1');
      expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/v1/schedules/sched-1' && init?.method === 'DELETE')).toHaveLength(1);
    });
  });
});
