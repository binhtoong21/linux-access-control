import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ZonesPage } from './ZonesPage';
import type { Zone } from '../api/types';

const mockZones: Zone[] = [
  {
    id: 'z-1',
    name: 'Phòng Lab 01',
    location: 'Tầng 3 Nhà A',
    description: 'Dành cho môn Mạng máy tính',
    workstation_count: 20,
    created_at: '2026-11-10T08:00:00Z',
    updated_at: '2026-11-10T08:00:00Z',
  },
  {
    id: 'z-2',
    name: 'Phòng Lab 02',
    location: 'Tầng 3 Nhà B',
    description: null,
    workstation_count: 0,
    created_at: '2026-11-11T09:00:00Z',
    updated_at: '2026-11-11T09:00:00Z',
  },
];

function renderZonesPage() {
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
        <ZonesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ZonesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists zones with workstation counts', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
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

    renderZonesPage();

    expect(await screen.findByText('Phòng Lab 01')).toBeInTheDocument();
    const row1 = screen.getByText('Phòng Lab 01').closest('tr')!;
    expect(within(row1).getByText('Tầng 3 Nhà A')).toBeInTheDocument();
    expect(within(row1).getByText('Dành cho môn Mạng máy tính')).toBeInTheDocument();
    expect(within(row1).getByText('20')).toBeInTheDocument();

    expect(screen.getByText('Phòng Lab 02')).toBeInTheDocument();
    const row2 = screen.getByText('Phòng Lab 02').closest('tr')!;
    expect(within(row2).getByText('Tầng 3 Nhà B')).toBeInTheDocument();
    expect(within(row2).getByText('—')).toBeInTheDocument();
    expect(within(row2).getByText('0')).toBeInTheDocument();
  });

  it('create sends POST /api/v1/zones', async () => {
    const user = userEvent.setup();
    let postCallDetails: { url: string; headers: HeadersInit; body: string } | null = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/zones' && init?.method === 'POST') {
        postCallDetails = {
          url,
          headers: init.headers as HeadersInit,
          body: init.body as string,
        };
        const newZone: Zone = {
          id: 'z-3',
          name: 'Phòng Lab 03',
          location: 'Tầng 4 Nhà C',
          description: 'Môn IoT',
          workstation_count: 0,
          created_at: '2026-11-12T10:00:00Z',
          updated_at: '2026-11-12T10:00:00Z',
        };
        return Promise.resolve({
          ok: true,
          status: 201,
          text: async () => JSON.stringify(newZone),
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

    renderZonesPage();

    await screen.findByText('Phòng Lab 01');

    const nameInput = screen.getByLabelText(/Tên \*/);
    const locationInput = screen.getByLabelText(/Vị trí \*/);
    const descInput = screen.getByLabelText(/Mô tả/);

    await user.type(nameInput, 'Phòng Lab 03');
    await user.type(locationInput, 'Tầng 4 Nhà C');
    await user.type(descInput, 'Môn IoT');

    const submitBtn = screen.getByRole('button', { name: 'Thêm zone' });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(postCallDetails).not.toBeNull();
    });

    expect(postCallDetails!.url).toBe('/api/v1/zones');
    expect(JSON.parse(postCallDetails!.body)).toEqual({
      name: 'Phòng Lab 03',
      location: 'Tầng 4 Nhà C',
      description: 'Môn IoT',
    });
    expect(nameInput).toHaveValue('');
    expect(locationInput).toHaveValue('');
    expect(descInput).toHaveValue('');
  });

  it('DUPLICATE message shows error and keeps inputs', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/zones' && init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 409,
          text: async () =>
            JSON.stringify({
              error: {
                code: 'DUPLICATE',
                message: 'Zone already exists',
              },
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

    renderZonesPage();

    await screen.findByText('Phòng Lab 01');

    const nameInput = screen.getByLabelText(/Tên \*/);
    const locationInput = screen.getByLabelText(/Vị trí \*/);
    const descInput = screen.getByLabelText(/Mô tả/);

    await user.type(nameInput, 'Phòng Lab 01');
    await user.type(locationInput, 'Tầng 3 Nhà A');
    await user.type(descInput, 'Mô tả trùng');

    const submitBtn = screen.getByRole('button', { name: 'Thêm zone' });
    await user.click(submitBtn);

    expect(await screen.findByText('Đã tồn tại (trùng mã hoặc tên).')).toBeInTheDocument();
    expect(nameInput).toHaveValue('Phòng Lab 01');
    expect(locationInput).toHaveValue('Tầng 3 Nhà A');
    expect(descInput).toHaveValue('Mô tả trùng');
  });

  it('delete only after confirm', async () => {
    const user = userEvent.setup();
    let deleteCallUrl: string | null = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/zones/z-2' && init?.method === 'DELETE') {
        deleteCallUrl = url;
        return Promise.resolve({
          ok: true,
          status: 204,
          text: async () => '',
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

    const confirmSpy = vi.spyOn(window, 'confirm');

    renderZonesPage();

    await screen.findByText('Phòng Lab 02');
    const row2 = screen.getByText('Phòng Lab 02').closest('tr')!;
    const deleteBtn = within(row2).getByRole('button', { name: 'Xóa' });

    // 1. Cancel confirm
    confirmSpy.mockReturnValueOnce(false);
    await user.click(deleteBtn);
    expect(confirmSpy).toHaveBeenCalledWith(
      'Xóa zone này? Các máy trong zone vẫn giữ nguyên, chỉ không còn thuộc zone.',
    );
    expect(deleteCallUrl).toBeNull();

    // 2. Accept confirm
    confirmSpy.mockReturnValueOnce(true);
    await user.click(deleteBtn);
    await waitFor(() => {
      expect(deleteCallUrl).toBe('/api/v1/zones/z-2');
    });
  });

  it('REFERENCED_BY_SCHEDULE message on delete conflict', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/zones/z-1' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: false,
          status: 409,
          text: async () =>
            JSON.stringify({
              error: {
                code: 'REFERENCED_BY_SCHEDULE',
                message: 'Zone referenced by schedule',
              },
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

    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderZonesPage();

    await screen.findByText('Phòng Lab 01');
    const row1 = screen.getByText('Phòng Lab 01').closest('tr')!;
    const deleteBtn = within(row1).getByRole('button', { name: 'Xóa' });

    await user.click(deleteBtn);

    expect(
      await screen.findByText('Đang được lịch sử dụng, không xóa được. Sửa hoặc xóa lịch trước.'),
    ).toBeInTheDocument();
  });
});
