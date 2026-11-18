import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkstationDetailPage } from './WorkstationDetailPage';
import type { WorkstationDetail, Zone } from '../api/types';

const mockWorkstationDetail: WorkstationDetail = {
  id: 'ws-1',
  mqtt_identity: 'ws-01',
  hostname: 'lab-a-01',
  zone: { id: 'z-1', name: 'Lab A' },
  status: 'enrolled',
  connectivity: 'online',
  last_heartbeat_at: '2026-11-18T10:30:00Z',
  trust_state: 'Fresh',
  clock_skew_detected: false,
  sync: { state: 'in_sync', desired_version: 15, acked_version: 15 },
  current_session: {
    user: { external_id: 'SV001', full_name: 'Nguyễn Văn A' },
    started_at: '2026-11-18T08:00:00Z',
    expires_at: '2026-11-18T12:00:00Z',
  },
  flags: ['stuck_sync'],
  machine_id: 'mach-1234',
  mac_address: '00:11:22:33:44:55',
  key_version: 2,
  cert_expires_at: '2027-11-18T10:30:00Z',
  last_apply_error: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-11-18T10:30:00Z',
  profiles: [
    {
      os_username: 'student',
      display_name: 'Sinh viên',
      profile_type: 'local',
      is_default: true,
      status: 'enabled',
      description: null,
      discovered_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      os_username: 'instructor',
      display_name: 'Giảng viên',
      profile_type: 'local',
      is_default: false,
      status: 'enabled',
      description: null,
      discovered_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      os_username: 'guest',
      display_name: 'Khách',
      profile_type: 'local',
      is_default: false,
      status: 'disabled',
      description: null,
      discovered_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
};

const mockZones: Zone[] = [
  {
    id: 'z-1',
    name: 'Lab A',
    location: 'Phòng A1',
    description: null,
    workstation_count: 5,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'z-2',
    name: 'Lab B',
    location: 'Phòng B2',
    description: null,
    workstation_count: 8,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

function renderWorkstationDetailPage(id = 'ws-1') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/workstations/${id}`]}>
        <Routes>
          <Route path="/workstations/:id" element={<WorkstationDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WorkstationDetailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders detail and profiles', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations/ws-1') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstationDetail),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWorkstationDetailPage();

    expect(await screen.findByText('ws-01')).toBeInTheDocument();
    expect(screen.getByText('lab-a-01')).toBeInTheDocument();
    expect(screen.getByText('Đã ghi danh')).toBeInTheDocument();
    expect(screen.getByText('Sẵn sàng')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lịch sử quẹt thẻ' })).toHaveAttribute(
      'href',
      '/history?tab=audit&workstation_id=ws-1',
    );
    expect(screen.getByRole('link', { name: 'Phiên' })).toHaveAttribute(
      'href',
      '/history?tab=sessions&workstation_id=ws-1',
    );
    expect(screen.getByText('00:11:22:33:44:55')).toBeInTheDocument();
    expect(screen.getByText('mach-1234')).toBeInTheDocument();
    expect(screen.getByText('student')).toBeInTheDocument();
    expect(screen.getByText('Sinh viên')).toBeInTheDocument();
    expect(screen.getByText('instructor')).toBeInTheDocument();
    expect(screen.getByText('Giảng viên')).toBeInTheDocument();
    expect(screen.getByText('guest')).toBeInTheDocument();
    expect(screen.getByText('Khách')).toBeInTheDocument();
  });

  it('choosing another default sends PATCH …/profiles/{name} with {"is_default":true}', async () => {
    const user = userEvent.setup();
    let patchBody: unknown = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/workstations/ws-1') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstationDetail),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      if (
        url === '/api/v1/workstations/ws-1/profiles/instructor' &&
        init?.method === 'PATCH'
      ) {
        patchBody = JSON.parse(init.body as string);
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              ...mockWorkstationDetail.profiles[1],
              is_default: true,
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWorkstationDetailPage();

    const instructorRadio = await screen.findByRole('radio', {
      name: 'Mặc định instructor',
    });
    expect(instructorRadio).not.toBeChecked();

    await user.click(instructorRadio);

    await waitFor(() => {
      expect(patchBody).toEqual({ is_default: true });
    });
  });

  it('turning off the default asks for confirmation and sends nothing when cancelled', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations/ws-1') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstationDetail),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWorkstationDetailPage();

    const studentRow = (await screen.findByText('student')).closest('tr')!;
    const turnOffBtn = within(studentRow).getByRole('button', { name: 'Tắt' });

    await user.click(turnOffBtn);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Tắt profile mặc định?')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Đây là profile mặc định. Tắt nó thì các lịch không chỉ định profile sẽ bị từ chối ở máy này. Tiếp tục?',
      ),
    ).toBeInTheDocument();

    const cancelBtn = within(dialog).getByRole('button', { name: 'Hủy' });
    await user.click(cancelBtn);

    const profileCalls = fetchMock.mock.calls.filter(([url]) =>
      url.includes('/profiles/student'),
    );
    expect(profileCalls).toHaveLength(0);
  });

  it('turning off the default and confirming sends PATCH …/profiles/{name} with {"status":"disabled"}', async () => {
    const user = userEvent.setup();
    let patchBody: unknown = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/workstations/ws-1') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstationDetail),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      if (
        url === '/api/v1/workstations/ws-1/profiles/student' &&
        init?.method === 'PATCH'
      ) {
        patchBody = JSON.parse(init.body as string);
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              ...mockWorkstationDetail.profiles[0],
              status: 'disabled',
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWorkstationDetailPage();

    const studentRow = (await screen.findByText('student')).closest('tr')!;
    const turnOffBtn = within(studentRow).getByRole('button', { name: 'Tắt' });

    await user.click(turnOffBtn);

    const dialog = await screen.findByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: 'Tắt profile' });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(patchBody).toEqual({ status: 'disabled' });
    });
  });

  it('turning off a non-default profile sends {"status":"disabled"} without a confirm', async () => {
    const user = userEvent.setup();
    let patchBody: unknown = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/workstations/ws-1') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstationDetail),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      if (
        url === '/api/v1/workstations/ws-1/profiles/instructor' &&
        init?.method === 'PATCH'
      ) {
        patchBody = JSON.parse(init.body as string);
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              ...mockWorkstationDetail.profiles[1],
              status: 'disabled',
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWorkstationDetailPage();

    const instructorRow = (await screen.findByText('instructor')).closest('tr')!;
    const turnOffBtn = within(instructorRow).getByRole('button', { name: 'Tắt' });

    await user.click(turnOffBtn);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(patchBody).toEqual({ status: 'disabled' });
    });
  });

  it('zone change sends {"zone_id":…} and {"zone_id":null} for the empty option', async () => {
    const user = userEvent.setup();
    const zonePatchBodies: unknown[] = [];

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/workstations/ws-1' && (!init || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstationDetail),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      if (url === '/api/v1/workstations/ws-1' && init?.method === 'PATCH') {
        zonePatchBodies.push(JSON.parse(init.body as string));
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstationDetail),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWorkstationDetailPage();

    const zoneSelect = await screen.findByLabelText(/Zone:/i);
    expect(zoneSelect).toHaveValue('z-1');

    await user.selectOptions(zoneSelect, 'z-2');
    await waitFor(() => {
      expect(zonePatchBodies).toContainEqual({ zone_id: 'z-2' });
    });

    await user.selectOptions(zoneSelect, '');
    await waitFor(() => {
      expect(zonePatchBodies).toContainEqual({ zone_id: null });
    });
  });

  it('disable sends nothing when the typed name is wrong and one POST …/disable with {"confirm":true} when right', async () => {
    const user = userEvent.setup();
    let disableCallBody: unknown = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/workstations/ws-1') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstationDetail),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      if (url === '/api/v1/workstations/ws-1/disable' && init?.method === 'POST') {
        disableCallBody = JSON.parse(init.body as string);
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ ...mockWorkstationDetail, status: 'disabled' }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWorkstationDetailPage();

    const disableBtn = await screen.findByRole('button', {
      name: 'Vô hiệu hóa máy',
    });

    await user.click(disableBtn);

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Vô hiệu hóa máy ws-01?'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Máy bị thu hồi chứng chỉ ngay. Máy vẫn cho quẹt thẻ đến khi hết hạn tin cậy (tối đa 24 giờ). Không thể bật lại, trừ khi cài lại và duyệt lại.',
      ),
    ).toBeInTheDocument();

    const confirmBtn = within(dialog).getByRole('button', { name: 'Vô hiệu hóa' });
    expect(confirmBtn).toBeDisabled();

    // 1. Wrong name
    const input = within(dialog).getByLabelText(/Gõ ws-01 để xác nhận/i);
    await user.type(input, 'wrong-hostname');
    expect(confirmBtn).toBeDisabled();
    expect(disableCallBody).toBeNull();

    // 2. Right name: ws-01 (mqtt_identity)
    await user.clear(input);
    await user.type(input, 'ws-01');
    expect(confirmBtn).not.toBeDisabled();

    await user.click(confirmBtn);

    await waitFor(() => {
      expect(disableCallBody).toEqual({ confirm: true });
    });
  });

  it('shows "Không tìm thấy máy" on 404', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations/not-found') {
        return Promise.resolve({
          ok: false,
          status: 404,
          text: async () =>
            JSON.stringify({
              error: { code: 'NOT_FOUND', message: 'Workstation not found' },
            }),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWorkstationDetailPage('not-found');

    expect(await screen.findByText('Không tìm thấy máy')).toBeInTheDocument();
  });

  it('renders ingest_rejects and security_alert flag badges as links to /issues?workstation_id={id}', async () => {
    const detailWithFlags: WorkstationDetail = {
      ...mockWorkstationDetail,
      flags: ['ingest_rejects', 'security_alert', 'stuck_sync'],
    };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/workstations/ws-1') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(detailWithFlags),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWorkstationDetailPage('ws-1');

    const rejectBadgeLink = await screen.findByRole('link', { name: 'Nhật ký lỗi' });
    expect(rejectBadgeLink).toHaveAttribute('href', '/issues?workstation_id=ws-1');

    const alertBadgeLink = screen.getByRole('link', { name: 'Cảnh báo an ninh' });
    expect(alertBadgeLink).toHaveAttribute('href', '/issues?workstation_id=ws-1');

    const stuckSpan = screen.getByText('Kẹt đồng bộ');
    expect(stuckSpan.tagName.toLowerCase()).toBe('span');
  });
});
