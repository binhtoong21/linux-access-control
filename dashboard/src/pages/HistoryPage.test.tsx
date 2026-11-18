import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HistoryPage } from './HistoryPage';
import { getVnDateString } from './history/AuditTab';
import type {
  AdminAction,
  AuditLog,
  AuditLogDetail,
  Page,
  Session,
  WorkstationSummary,
  Zone,
} from '../api/types';

const mockWorkstation: WorkstationSummary = {
  id: 'ws-1',
  mqtt_identity: 'ws-lab-01',
  hostname: 'lab01',
  zone: { id: 'z-1', name: 'Phòng Lab 1' },
  status: 'active',
  connectivity: 'online',
  last_heartbeat_at: '2026-11-18T10:00:00Z',
  trust_state: 'Fresh',
  clock_skew_detected: false,
  sync: { state: 'in_sync', desired_version: 1, acked_version: 1 },
  current_session: null,
  flags: [],
};

const mockZone: Zone = {
  id: 'z-1',
  name: 'Phòng Lab 1',
  location: 'Tầng 1',
  description: null,
  workstation_count: 1,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

function renderHistoryPage(initialEntries = ['/history']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/history" element={<HistoryPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HistoryPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('default tab audit renders rows with Vietnamese labels and the nhận lúc note only for a late record', async () => {
    const normalLog: AuditLog = {
      id: 'log-normal',
      entry_id: 'e-1',
      occurred_at: '2026-11-18T10:00:00Z',
      received_at: '2026-11-18T10:00:30Z', // 30 sec diff <= 5 min
      outcome: 'granted',
      reason: 'granted',
      detail: null,
      user: { id: 'u-1', external_id: 'SV01', full_name: 'Nguyễn Văn A' },
      card: { id: 'c-1', status: 'active' },
      workstation: { id: 'ws-1', mqtt_identity: 'ws-lab-01', hostname: 'lab01', zone: null },
      target_os_username: 'student01',
      data_version: 1,
      matched_schedule_ids: [],
      has_card_uid: false,
    };

    const lateLog: AuditLog = {
      id: 'log-late',
      entry_id: 'e-2',
      occurred_at: '2026-11-18T08:00:00Z',
      received_at: '2026-11-18T09:00:00Z', // 60 min diff > 5 min
      outcome: 'denied',
      reason: 'unknown_card',
      detail: null,
      user: null,
      card: null,
      workstation: { id: 'ws-1', mqtt_identity: 'ws-lab-01', hostname: 'lab01', zone: null },
      target_os_username: null,
      data_version: 1,
      matched_schedule_ids: [],
      has_card_uid: true,
    };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify([mockWorkstation]),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify([mockZone]),
        });
      }
      if (url.startsWith('/api/v1/audit-logs')) {
        const page: Page<AuditLog> = {
          items: [normalLog, lateLog],
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

    renderHistoryPage(['/history']);

    // Check Vietnamese labels
    expect(await screen.findByText('Cho vào')).toBeInTheDocument();
    expect(screen.getByText('Hợp lệ')).toBeInTheDocument();
    expect(screen.getByText('student01')).toBeInTheDocument();
    expect(screen.getByText('SV01 — Nguyễn Văn A')).toBeInTheDocument();

    expect(screen.getByText('Từ chối')).toBeInTheDocument();
    expect(screen.getByText('Thẻ chưa đăng ký')).toBeInTheDocument();
    expect(screen.getByText('Đăng ký thẻ này')).toBeInTheDocument();

    // Check header note
    expect(screen.getByText('Thời điểm theo đồng hồ của máy trạm.')).toBeInTheDocument();

    // Check late record note: only 1 late record has "nhận lúc"
    const lateNotes = screen.getAllByText(/nhận lúc/);
    expect(lateNotes).toHaveLength(1);
  });

  it('quick ranges end at 00:00 of the next day (to is exclusive) and 7 days include today', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/v1/audit-logs')) {
        return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ items: [], next_cursor: null }) });
      }
      return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify([]) });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderHistoryPage();

    const day = 24 * 60 * 60 * 1000;
    const tomorrow = getVnDateString(new Date(Date.now() + day));
    const sixDaysAgo = getVnDateString(new Date(Date.now() - 6 * day));
    const auditUrls = () => fetchMock.mock.calls.map(([u]) => u as string).filter((u) => u.startsWith('/api/v1/audit-logs'));

    await user.click(await screen.findByRole('button', { name: 'Hôm nay' }));
    await waitFor(() => expect(auditUrls().some((u) => decodeURIComponent(u).includes(`to=${tomorrow}T00:00:00+07:00`))).toBe(true));
    await user.click(screen.getByRole('button', { name: '7 ngày' }));
    await waitFor(() => expect(auditUrls().some((u) => decodeURIComponent(u).includes(`from=${sixDaysAgo}T00:00:00+07:00`))).toBe(true));
  });

  it('filters send outcome=denied and workstation_id=', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify([mockWorkstation]),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify([mockZone]),
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

    renderHistoryPage(['/history']);

    // Wait for workstations dropdown to load
    await screen.findByRole('option', { name: 'ws-lab-01 (lab01)' });

    // Select workstation ws-1
    await user.selectOptions(screen.getByLabelText('Chọn máy'), 'ws-1');

    // Select outcome denied
    await user.selectOptions(screen.getByLabelText('Chọn kết quả'), 'denied');

    await waitFor(() => {
      const calls = fetchMock.mock.calls
        .map(([u]) => u as string)
        .filter((u) => u.startsWith('/api/v1/audit-logs'));
      expect(calls.some((u) => u.includes('workstation_id=ws-1') && u.includes('outcome=denied'))).toBe(true);
    });
  });

  it('?tab=sessions&workstation_id=ws-1 loads GET /api/v1/sessions?workstation_id=ws-1…', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify([mockWorkstation]),
        });
      }
      if (url.startsWith('/api/v1/sessions')) {
        const page: Page<Session> = { items: [], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderHistoryPage(['/history?tab=sessions&workstation_id=ws-1']);

    await waitFor(() => {
      const calls = fetchMock.mock.calls
        .map(([u]) => u as string)
        .filter((u) => u.startsWith('/api/v1/sessions'));
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0]).toContain('workstation_id=ws-1');
    });
  });

  it('session end reason labels', async () => {
    const mockSessions: Session[] = [
      {
        id: 's-1',
        decision_id: 'd-1',
        card_id: 'c-1',
        os_username: 'student01',
        boot_id: 'b-1',
        decided_at: '2026-11-18T08:00:00Z',
        started_at: '2026-11-18T08:00:00Z',
        expires_at: '2026-11-18T10:00:00Z',
        status: 'completed',
        ended_at: '2026-11-18T09:30:00Z',
        end_reason: 'user_logout',
        end_source: 'reported',
        user: { id: 'u-1', external_id: 'SV01', full_name: 'Nguyễn Văn A' },
        workstation: { id: 'ws-1', mqtt_identity: 'ws-lab-01' },
      },
      {
        id: 's-2',
        decision_id: 'd-2',
        card_id: 'c-2',
        os_username: 'student02',
        boot_id: 'b-2',
        decided_at: '2026-11-18T08:00:00Z',
        started_at: '2026-11-18T08:00:00Z',
        expires_at: '2026-11-18T10:00:00Z',
        status: 'forced_logout',
        ended_at: '2026-11-18T10:00:00Z',
        end_reason: 'schedule_expired',
        end_source: 'reconstructed',
        user: { id: 'u-2', external_id: 'SV02', full_name: 'Trần Thị B' },
        workstation: { id: 'ws-1', mqtt_identity: 'ws-lab-01' },
      },
      {
        id: 's-3',
        decision_id: 'd-3',
        card_id: 'c-3',
        os_username: 'student03',
        boot_id: 'b-3',
        decided_at: '2026-11-18T08:00:00Z',
        started_at: '2026-11-18T08:00:00Z',
        expires_at: '2020-01-01T10:00:00Z', // past expires_at
        status: 'active',
        ended_at: null,
        end_reason: null,
        end_source: null,
        user: { id: 'u-3', external_id: 'SV03', full_name: 'Lê Văn C' },
        workstation: { id: 'ws-1', mqtt_identity: 'ws-lab-01' },
      },
    ];

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify([mockWorkstation]),
        });
      }
      if (url.startsWith('/api/v1/sessions')) {
        const page: Page<Session> = { items: mockSessions, next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderHistoryPage(['/history?tab=sessions']);

    expect(await screen.findByText('Tự đăng xuất')).toBeInTheDocument();
    expect(screen.getByText('Hết giờ (dựng lại khi máy khởi động)')).toBeInTheDocument();
    expect(screen.getByText('quá hạn chưa kết thúc')).toBeInTheDocument();
  });

  it('admin tab toggles JSON', async () => {
    const user = userEvent.setup();

    const mockAdminAction: AdminAction = {
      id: 'act-1',
      action: 'update_zone',
      entity_type: 'zone',
      entity_id: '12345678-aaaa-bbbb-cccc-dddddddddddd',
      before: { name: 'Old Zone Name' },
      after: { name: 'New Zone Name' },
      occurred_at: '2026-11-18T09:15:00Z',
      admin: { id: 'adm-1', username: 'admin01', display_name: 'Quản trị viên' },
    };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/v1/admin-audit-logs')) {
        const page: Page<AdminAction> = { items: [mockAdminAction], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderHistoryPage(['/history?tab=admin']);

    expect(await screen.findByText('Quản trị viên')).toBeInTheDocument();
    expect(screen.getByText('update_zone')).toBeInTheDocument();
    expect(screen.getByText('zone 12345678')).toBeInTheDocument();

    // Before clicking Chi tiết, pre tags with JSON are not displayed
    expect(screen.queryByText(/Old Zone Name/)).not.toBeInTheDocument();

    // Click Chi tiết
    const toggleBtn = screen.getByRole('button', { name: 'Chi tiết' });
    await user.click(toggleBtn);

    expect(await screen.findByText(/Old Zone Name/)).toBeInTheDocument();
    expect(screen.getByText(/New Zone Name/)).toBeInTheDocument();

    // Click Ẩn chi tiết
    await user.click(screen.getByRole('button', { name: 'Ẩn chi tiết' }));
    expect(screen.queryByText(/Old Zone Name/)).not.toBeInTheDocument();
  });

  it('Tải thêm sends cursor=', async () => {
    const user = userEvent.setup();

    const mockLog1: AuditLog = {
      id: 'log-1',
      entry_id: 'e-1',
      occurred_at: '2026-11-18T10:00:00Z',
      received_at: '2026-11-18T10:00:01Z',
      outcome: 'granted',
      reason: 'granted',
      detail: null,
      user: null,
      card: null,
      workstation: null,
      target_os_username: null,
      data_version: 1,
      matched_schedule_ids: [],
      has_card_uid: false,
    };

    const mockLog2: AuditLog = {
      id: 'log-2',
      entry_id: 'e-2',
      occurred_at: '2026-11-18T09:00:00Z',
      received_at: '2026-11-18T09:00:01Z',
      outcome: 'denied',
      reason: 'out_of_schedule',
      detail: null,
      user: null,
      card: null,
      workstation: null,
      target_os_username: null,
      data_version: 1,
      matched_schedule_ids: [],
      has_card_uid: false,
    };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify([]),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify([]),
        });
      }
      if (url.startsWith('/api/v1/audit-logs')) {
        if (url.includes('cursor=cursor-token-123')) {
          const page2: Page<AuditLog> = { items: [mockLog2], next_cursor: null };
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => JSON.stringify(page2),
          });
        }
        const page1: Page<AuditLog> = { items: [mockLog1], next_cursor: 'cursor-token-123' };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page1),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderHistoryPage(['/history']);

    expect(await screen.findByText('Hợp lệ')).toBeInTheDocument();

    const loadMoreBtn = screen.getByRole('button', { name: 'Tải thêm' });
    await user.click(loadMoreBtn);

    expect(await screen.findByText('Ngoài giờ được phép')).toBeInTheDocument();

    const calls = fetchMock.mock.calls
      .map(([u]) => u as string)
      .filter((u) => u.startsWith('/api/v1/audit-logs'));
    expect(calls.some((u) => u.includes('cursor=cursor-token-123'))).toBe(true);
  });

  it('INVALID_UID message', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify([]),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify([]),
        });
      }
      if (url.startsWith('/api/v1/audit-logs')) {
        if (url.includes('card_uid=BADUID')) {
          return Promise.resolve({
            ok: false,
            status: 400,
            text: async () =>
              JSON.stringify({
                error: {
                  code: 'INVALID_UID',
                  message: 'Invalid UID format',
                },
              }),
          });
        }
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

    renderHistoryPage(['/history']);

    const cardUidInput = await screen.findByPlaceholderText(/UID thẻ/);
    await user.type(cardUidInput, 'BADUID');

    expect(
      await screen.findByText('UID không hợp lệ: cần 4, 7 hoặc 10 byte dạng hex.'),
    ).toBeInTheDocument();
  });

  it('Xem UID reveals card UID inline and never shows UID before click', async () => {
    const user = userEvent.setup();

    const mockLogWithUid: AuditLog = {
      id: 'log-reveal',
      entry_id: 'e-reveal',
      occurred_at: '2026-11-18T10:00:00Z',
      received_at: '2026-11-18T10:00:01Z',
      outcome: 'denied',
      reason: 'unknown_card',
      detail: null,
      user: null,
      card: null,
      workstation: null,
      target_os_username: null,
      data_version: 1,
      matched_schedule_ids: [],
      has_card_uid: true,
    };

    const mockDetail: AuditLogDetail = {
      ...mockLogWithUid,
      card_uid: '04A32B1C5D6E80',
      reader_raw: null,
    };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify([]),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify([]),
        });
      }
      if (url === '/api/v1/audit-logs/log-reveal') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockDetail),
        });
      }
      if (url.startsWith('/api/v1/audit-logs')) {
        const page: Page<AuditLog> = { items: [mockLogWithUid], next_cursor: null };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(page),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderHistoryPage(['/history']);

    // UID must NOT be in document before Xem UID
    expect(screen.queryByText('04A32B1C5D6E80')).not.toBeInTheDocument();

    const xemUidBtn = await screen.findByRole('button', { name: 'Xem UID' });
    await user.click(xemUidBtn);

    // UID is revealed inline
    expect(await screen.findByText('04A32B1C5D6E80')).toBeInTheDocument();
  });
});
