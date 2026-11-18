import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScheduleFormPage } from './ScheduleFormPage';
import type { Group, Schedule, WorkstationSummary, Zone } from '../api/types';

const mockGroups: Group[] = [
  {
    id: 'g-1',
    name: 'Nhóm L01',
    description: null,
    member_count: 5,
    created_at: '2026-11-10T08:00:00Z',
    updated_at: '2026-11-10T08:00:00Z',
  },
];

const mockZones: Zone[] = [
  {
    id: 'z-1',
    name: 'Phòng Lab 01',
    location: 'Tầng 3 Nhà A',
    description: null,
    workstation_count: 20,
    created_at: '2026-11-10T08:00:00Z',
    updated_at: '2026-11-10T08:00:00Z',
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

const mockExistingSchedule: Schedule = {
  id: 'sched-1',
  name: 'Lịch bảo trì',
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
  valid_to: null,
  days_of_week: ['MONDAY', 'TUESDAY'],
  start_time: '08:00',
  end_time: '12:00',
  target_os_username: null,
  status: 'enabled',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

function renderScheduleForm(initialRoute = '/schedules/new') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/schedules" element={<div>Trang danh sách lịch</div>} />
          <Route path="/schedules/new" element={<ScheduleFormPage />} />
          <Route path="/schedules/:id/edit" element={<ScheduleFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ScheduleFormPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('invalid time blocks the check (no validate call)', async () => {
    const user = userEvent.setup();
    let validateCalled = false;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/groups') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockGroups),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstations),
        });
      }
      if (url === '/api/v1/schedules/validate' && init?.method === 'POST') {
        validateCalled = true;
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ errors: [], warnings: [] }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderScheduleForm();

    await screen.findByLabelText(/Tên \*/);

    // Fill valid name
    await user.type(screen.getByLabelText(/Tên \*/), 'Ca thực hành mạng');

    // Select group
    const groupSelect = await screen.findByLabelText('Chọn nhóm');
    await user.selectOptions(groupSelect, 'g-1');

    // Select zone
    const zoneSelect = await screen.findByLabelText('Chọn zone');
    await user.selectOptions(zoneSelect, 'z-1');

    // Select quick days T2–T6
    await user.click(screen.getByRole('button', { name: 'T2–T6' }));

    // Enter invalid start time (7:30 instead of 07:30)
    const startTimeInput = screen.getByLabelText(/Giờ bắt đầu \*/);
    await user.type(startTimeInput, '7:30');

    // Enter valid end time
    const endTimeInput = screen.getByLabelText(/Giờ kết thúc \*/);
    await user.type(endTimeInput, '11:30');

    // Local error shown
    expect(await screen.findByText('Giờ bắt đầu không hợp lệ (HH:MM)')).toBeInTheDocument();

    // Wait 650 ms (exceeding 500 ms debounce)
    await new Promise((r) => setTimeout(r, 650));

    expect(validateCalled).toBe(false);
  });

  it('a valid form calls POST /api/v1/schedules/validate', async () => {
    const user = userEvent.setup();
    let validateBody: string | null = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/groups') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockGroups),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstations),
        });
      }
      if (url === '/api/v1/schedules/validate' && init?.method === 'POST') {
        validateBody = init.body as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ errors: [], warnings: [] }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderScheduleForm();

    await screen.findByLabelText(/Tên \*/);

    await user.type(screen.getByLabelText(/Tên \*/), 'Ca học kỳ 1');
    const groupSelect = await screen.findByLabelText('Chọn nhóm');
    await user.selectOptions(groupSelect, 'g-1');
    const zoneSelect = await screen.findByLabelText('Chọn zone');
    await user.selectOptions(zoneSelect, 'z-1');
    await user.click(screen.getByRole('button', { name: 'T2–T6' }));

    await user.type(screen.getByLabelText(/Giờ bắt đầu \*/), '07:30');
    await user.type(screen.getByLabelText(/Giờ kết thúc \*/), '11:30');

    await waitFor(
      () => {
        expect(validateBody).not.toBeNull();
      },
      { timeout: 2000 },
    );

    const parsed = JSON.parse(validateBody!);
    expect(parsed.name).toBe('Ca học kỳ 1');
    expect(parsed.subject).toEqual({ type: 'group', id: 'g-1' });
    expect(parsed.target).toEqual({ type: 'zone', id: 'z-1' });
    expect(parsed.days_of_week).toEqual([
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
    ]);
    expect(parsed.start_time).toBe('07:30');
    expect(parsed.end_time).toBe('11:30');
  });

  it('server errors disable Lưu', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/groups') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockGroups),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstations),
        });
      }
      if (url === '/api/v1/schedules/validate' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              errors: [{ field: 'name', constraints: ['Tên lịch đã tồn tại'] }],
              warnings: [],
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderScheduleForm();

    await user.type(screen.getByLabelText(/Tên \*/), 'Lịch trùng');
    const groupSelect = await screen.findByLabelText('Chọn nhóm');
    await user.selectOptions(groupSelect, 'g-1');
    const zoneSelect = await screen.findByLabelText('Chọn zone');
    await user.selectOptions(zoneSelect, 'z-1');
    await user.click(screen.getByRole('button', { name: 'T2–T6' }));
    await user.type(screen.getByLabelText(/Giờ bắt đầu \*/), '07:30');
    await user.type(screen.getByLabelText(/Giờ kết thúc \*/), '11:30');

    expect(await screen.findByText('Tên lịch đã tồn tại')).toBeInTheDocument();
    const saveButton = screen.getByRole('button', { name: 'Lưu' });
    expect(saveButton).toBeDisabled();
  });

  it('a failed check keeps Lưu disabled and never saves', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(body) });
      if (url === '/api/v1/groups') return ok(mockGroups);
      if (url === '/api/v1/zones') return ok(mockZones);
      if (url === '/api/v1/workstations') return ok(mockWorkstations);
      if (url === '/api/v1/schedules/validate' && init?.method === 'POST') {
        return Promise.resolve({ ok: false, status: 500, text: async () => '' });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderScheduleForm();
    await user.type(screen.getByLabelText(/Tên \*/), 'Lịch A');
    await user.selectOptions(await screen.findByLabelText('Chọn nhóm'), 'g-1');
    await user.selectOptions(await screen.findByLabelText('Chọn zone'), 'z-1');
    await user.click(screen.getByRole('button', { name: 'T2–T6' }));
    await user.type(screen.getByLabelText(/Giờ bắt đầu \*/), '07:30');
    await user.type(screen.getByLabelText(/Giờ kết thúc \*/), '11:30');

    expect(await screen.findByText(/Không kiểm tra được lịch/)).toBeInTheDocument();
    const saveButton = screen.getByRole('button', { name: 'Lưu' });
    expect(saveButton).toBeDisabled();
    await user.click(saveButton);
    expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/v1/schedules' && (i as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('a missing_profile warning shows the machine and saving asks confirm (cancel = no POST)', async () => {
    const user = userEvent.setup();
    let postCallOccurred = false;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/groups') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockGroups),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstations),
        });
      }
      if (url === '/api/v1/schedules/validate' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              errors: [],
              warnings: [
                {
                  code: 'missing_profile',
                  message: '',
                  workstations: [{ id: 'ws-1', mqtt_identity: 'ws-lab01-01' }],
                  target_os_username: 'student',
                },
              ],
            }),
        });
      }
      if (url === '/api/v1/schedules' && init?.method === 'POST') {
        postCallOccurred = true;
        return Promise.resolve({
          ok: true,
          status: 201,
          text: async () => JSON.stringify(mockExistingSchedule),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderScheduleForm();

    await user.type(screen.getByLabelText(/Tên \*/), 'Lịch học máy thiếu profile');
    const groupSelect = await screen.findByLabelText('Chọn nhóm');
    await user.selectOptions(groupSelect, 'g-1');
    const zoneSelect = await screen.findByLabelText('Chọn zone');
    await user.selectOptions(zoneSelect, 'z-1');
    await user.click(screen.getByRole('button', { name: 'T2–T6' }));
    await user.type(screen.getByLabelText(/Giờ bắt đầu \*/), '07:30');
    await user.type(screen.getByLabelText(/Giờ kết thúc \*/), '11:30');

    // Wait for warning with workstation link
    expect(await screen.findByText(/chưa có profile student đang bật/)).toBeInTheDocument();
    const wsLink = screen.getByRole('link', { name: 'ws-lab01-01' });
    expect(wsLink).toHaveAttribute('href', '/workstations/ws-1');

    const saveButton = screen.getByRole('button', { name: 'Lưu' });
    expect(saveButton).toBeEnabled();

    // 1. User cancels confirm -> NO post
    await user.click(saveButton);

    expect(within(screen.getByRole('dialog')).getByText('Lịch có cảnh báo (xem bên dưới). Vẫn lưu?')).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Hủy' }));
    expect(postCallOccurred).toBe(false);

    // 2. User confirms -> POST sent
    await user.click(saveButton);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Lưu' }));

    await waitFor(() => {
      expect(postCallOccurred).toBe(true);
      expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/v1/schedules' && init?.method === 'POST')).toHaveLength(1);
    });
  });

  it('edit mode sends schedule_id in validate and PATCH /api/v1/schedules/{id} on save', async () => {
    const user = userEvent.setup();
    let validateBody: string | null = null;
    let patchUrl: string | null = null;
    let patchBody: string | null = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/schedules/sched-1' && init?.method === 'PATCH') {
        patchUrl = url;
        patchBody = init.body as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockExistingSchedule),
        });
      }
      if (url === '/api/v1/schedules/sched-1') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockExistingSchedule),
        });
      }
      if (url === '/api/v1/groups') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockGroups),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstations),
        });
      }
      if (url === '/api/v1/schedules/validate' && init?.method === 'POST') {
        validateBody = init.body as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ errors: [], warnings: [] }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderScheduleForm('/schedules/sched-1/edit');

    // Wait for existing data to load
    expect(await screen.findByDisplayValue('Lịch bảo trì')).toBeInTheDocument();

    // Verify validate was called with schedule_id
    await waitFor(
      () => {
        expect(validateBody).not.toBeNull();
      },
      { timeout: 2000 },
    );
    const parsedValidate = JSON.parse(validateBody!);
    expect(parsedValidate.schedule_id).toBe('sched-1');

    // Click Lưu
    const saveButton = await screen.findByRole('button', { name: 'Lưu' });
    await user.click(saveButton);

    await waitFor(() => {
      expect(patchUrl).toBe('/api/v1/schedules/sched-1');
    });

    const parsedPatch = JSON.parse(patchBody!);
    expect(parsedPatch.name).toBe('Lịch bảo trì');
    expect(parsedPatch.start_time).toBe('08:00');
    expect(parsedPatch.end_time).toBe('12:00');
  });

  it('a double click on Lưu sends one request', async () => {
    const user = userEvent.setup();
    let postCallCount = 0;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/groups') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockGroups),
        });
      }
      if (url === '/api/v1/zones') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockZones),
        });
      }
      if (url === '/api/v1/workstations') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockWorkstations),
        });
      }
      if (url === '/api/v1/schedules/validate' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ errors: [], warnings: [] }),
        });
      }
      if (url === '/api/v1/schedules' && init?.method === 'POST') {
        postCallCount++;
        // Delayed resolution
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                status: 201,
                text: async () => JSON.stringify(mockExistingSchedule),
              }),
            100,
          ),
        );
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderScheduleForm();

    await user.type(screen.getByLabelText(/Tên \*/), 'Lịch test double click');
    const groupSelect = await screen.findByLabelText('Chọn nhóm');
    await user.selectOptions(groupSelect, 'g-1');
    const zoneSelect = await screen.findByLabelText('Chọn zone');
    await user.selectOptions(zoneSelect, 'z-1');
    await user.click(screen.getByRole('button', { name: 'T2–T6' }));
    await user.type(screen.getByLabelText(/Giờ bắt đầu \*/), '07:30');
    await user.type(screen.getByLabelText(/Giờ kết thúc \*/), '11:30');

    const saveButton = await screen.findByRole('button', { name: 'Lưu' });
    await waitFor(() => expect(saveButton).toBeEnabled());

    // Double click rapidly
    user.click(saveButton);
    user.click(saveButton);

    await waitFor(
      () => {
        expect(postCallCount).toBe(1);
      },
      { timeout: 2000 },
    );

    // Wait a bit to ensure no secondary call
    await new Promise((r) => setTimeout(r, 200));
    expect(postCallCount).toBe(1);
  });

  it('changing a checked form blocks saving until the new form passes its own check', async () => {
    const user = userEvent.setup();
    let releaseCheck: (value: unknown) => void = () => {};
    const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/groups') return Promise.resolve(ok(mockGroups));
      if (url === '/api/v1/zones') return Promise.resolve(ok(mockZones));
      if (url === '/api/v1/workstations') return Promise.resolve(ok(mockWorkstations));
      if (url === '/api/v1/schedules/sched-1' && init?.method !== 'PATCH') return Promise.resolve(ok(mockExistingSchedule));
      if (url === '/api/v1/schedules/validate') {
        const input = JSON.parse(init?.body as string);
        if (input.name === mockExistingSchedule.name) return Promise.resolve(ok({ errors: [], warnings: [] }));
        return new Promise((resolve) => { releaseCheck = resolve; });
      }
      if (url === '/api/v1/schedules/sched-1' && init?.method === 'PATCH') return Promise.resolve(ok(mockExistingSchedule));
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderScheduleForm('/schedules/sched-1/edit');
    const nameInput = await screen.findByLabelText(/Tên \*/);
    const save = screen.getByRole('button', { name: 'Lưu' });
    await waitFor(() => expect(save).toBeEnabled());
    await user.type(nameInput, ' updated');
    expect(save).toBeDisabled();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) =>
      url === '/api/v1/schedules/validate' && JSON.parse(init?.body as string).name.endsWith(' updated'),
    )).toBe(true));
    expect(save).toBeDisabled();
    await user.click(save);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
    releaseCheck(ok({ errors: [], warnings: [] }));
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1));
  });

});
