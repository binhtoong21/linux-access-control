import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buildCsvTemplate, ImportPage } from './ImportPage';
import type { ImportResult } from '../api/types';

function renderImportPage(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ImportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const mockCleanResult: ImportResult = {
  applied: false,
  summary: {
    rows: 2,
    users_created: 1,
    users_updated: 0,
    users_unchanged: 1,
    groups_created: ['Lớp K65'],
    memberships_added: 1,
    cards_registered: 1,
    cards_bound: 0,
    errors: 0,
    warnings: 0,
  },
  ignored_columns: ['unknown_col'],
  rows: [
    {
      line: 2,
      external_id: 'SV001',
      action: 'create',
      groups_added: ['Lớp K65'],
      card: 'register',
      errors: [],
      warnings: [],
    },
    {
      line: 3,
      external_id: 'SV002',
      action: 'unchanged',
      groups_added: [],
      card: 'unchanged',
      errors: [],
      warnings: [],
    },
  ],
};

const mockErrorResult: ImportResult = {
  applied: false,
  summary: {
    rows: 2,
    users_created: 0,
    users_updated: 0,
    users_unchanged: 0,
    groups_created: [],
    memberships_added: 0,
    cards_registered: 0,
    cards_bound: 0,
    errors: 1,
    warnings: 1,
  },
  ignored_columns: [],
  rows: [
    {
      line: 2,
      external_id: 'SV_ERR',
      action: 'error',
      groups_added: [],
      card: null,
      errors: [{ code: 'INVALID_EXTERNAL_ID', message: 'external_id is invalid' }],
      warnings: [],
    },
    {
      line: 3,
      external_id: 'SV_WARN',
      action: 'unchanged',
      groups_added: [],
      card: null,
      errors: [],
      warnings: [{ code: 'USER_INACTIVE', message: 'User is inactive; not reactivated' }],
    },
  ],
};

describe('ImportPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('template produces a CSV starting with BOM and headers', () => {
    const template = buildCsvTemplate();
    expect(template.startsWith('\uFEFFexternal_id,full_name,email,groups,card_uid')).toBe(true);
    expect(template).toContain('SV001,Nguyễn Văn A,a@example.com,Lớp A;CLB B,');
    expect(template).toContain('SV002,Trần Thị B,,Lớp A,04A32B1C5D6E80');

    renderImportPage();
    expect(screen.getByText('Tải tệp mẫu')).toBeInTheDocument();
  });

  it('check sends {"csv": <text>, "apply": false} and displays summary and rows', async () => {
    const user = userEvent.setup();
    let postCallDetails: { url: string; body: { csv: string; apply: boolean } } | null = null;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/imports/roster' && init?.method === 'POST') {
        postCallDetails = {
          url,
          body: JSON.parse(init.body as string),
        };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockCleanResult),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderImportPage();

    const fileInput = screen.getByLabelText('Chọn tệp CSV');
    const csvContent = 'external_id,full_name\nSV001,Nguyễn Văn A\n';
    const file = new File([csvContent], 'roster.csv', { type: 'text/csv' });

    await user.upload(fileInput, file);
    expect(screen.getByText(/Tệp đã chọn:/)).toBeInTheDocument();
    expect(screen.getByText('roster.csv')).toBeInTheDocument();

    const checkBtn = screen.getByRole('button', { name: 'Kiểm tra' });
    await user.click(checkBtn);

    await waitFor(() => {
      expect(postCallDetails).not.toBeNull();
    });

    expect(postCallDetails!.url).toBe('/api/v1/imports/roster');
    expect(postCallDetails!.body).toEqual({
      csv: csvContent,
      apply: false,
    });

    // Summary fields
    expect(await screen.findByText('Tổng kết')).toBeInTheDocument();
    expect(screen.getByText('Số dòng')).toBeInTheDocument();
    expect(screen.getAllByText('Lớp K65').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Cột bị bỏ qua: unknown_col/)).toBeInTheDocument();

    // Table rows
    expect(screen.getByText('SV001')).toBeInTheDocument();
    expect(screen.getByText('SV002')).toBeInTheDocument();
    expect(screen.getAllByText('Tạo mới').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Đăng ký mới')).toBeInTheDocument();
  });

  it('Áp dụng is disabled when result has errors', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/imports/roster' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockErrorResult),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderImportPage();

    const fileInput = screen.getByLabelText('Chọn tệp CSV');
    const file = new File(['test'], 'error.csv', { type: 'text/csv' });
    await user.upload(fileInput, file);

    const checkBtn = screen.getByRole('button', { name: 'Kiểm tra' });
    await user.click(checkBtn);

    expect(await screen.findByText('SV_ERR')).toBeInTheDocument();
    expect(screen.getByText('external_id is invalid')).toBeInTheDocument();

    const applyBtn = screen.getByRole('button', { name: 'Áp dụng' });
    expect(applyBtn).toBeDisabled();
  });

  it('Áp dụng is enabled when clean, and after confirm sends apply: true exactly once even on double click', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    let applyCallCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/imports/roster' && init?.method === 'POST') {
        const payload = JSON.parse(init.body as string);
        if (payload.apply === false) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => JSON.stringify(mockCleanResult),
          });
        }
        if (payload.apply === true) {
          applyCallCount++;
          const appliedResult: ImportResult = {
            ...mockCleanResult,
            applied: true,
          };
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => JSON.stringify(appliedResult),
          });
        }
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderImportPage(queryClient);

    const fileInput = screen.getByLabelText('Chọn tệp CSV');
    const file = new File(['test-clean'], 'clean.csv', { type: 'text/csv' });
    await user.upload(fileInput, file);

    const checkBtn = screen.getByRole('button', { name: 'Kiểm tra' });
    await user.click(checkBtn);

    const applyBtn = await screen.findByRole('button', { name: 'Áp dụng' });
    expect(applyBtn).not.toBeDisabled();

    // Double click simulation
    await Promise.all([user.click(applyBtn), user.click(applyBtn)]);

    expect(confirmSpy).toHaveBeenCalledWith(
      'Áp dụng 2 dòng? Thay đổi có hiệu lực tại máy sau khi máy nhận dữ liệu mới.',
    );
    expect(applyCallCount).toBe(1);

    expect(await screen.findByText('Đã áp dụng.')).toBeInTheDocument();

    // Cache invalidation check
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['users'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['groups'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['cards'] });

    // After applying, Áp dụng is disabled
    expect(applyBtn).toBeDisabled();
  });

  it('applied: false on apply shows the changed-data message', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const conflictResult: ImportResult = {
      applied: false,
      summary: {
        ...mockCleanResult.summary,
        errors: 1,
      },
      ignored_columns: [],
      rows: [
        {
          line: 2,
          external_id: 'SV001',
          action: 'error',
          groups_added: [],
          card: null,
          errors: [{ code: 'CONFLICT', message: 'Data changed while importing; run the check again' }],
          warnings: [],
        },
      ],
    };

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/imports/roster' && init?.method === 'POST') {
        const payload = JSON.parse(init.body as string);
        if (payload.apply === false) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => JSON.stringify(mockCleanResult),
          });
        }
        if (payload.apply === true) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => JSON.stringify(conflictResult),
          });
        }
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderImportPage();

    const fileInput = screen.getByLabelText('Chọn tệp CSV');
    const file = new File(['test'], 'file.csv', { type: 'text/csv' });
    await user.upload(fileInput, file);

    await user.click(screen.getByRole('button', { name: 'Kiểm tra' }));

    const applyBtn = await screen.findByRole('button', { name: 'Áp dụng' });
    await user.click(applyBtn);

    expect(
      await screen.findByText(
        'Không áp dụng được: dữ liệu đã thay đổi từ lần kiểm tra, xem các lỗi bên dưới.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Data changed while importing; run the check again')).toBeInTheDocument();
  });

  it('choosing another file disables Áp dụng again', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/imports/roster' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockCleanResult),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderImportPage();

    const fileInput = screen.getByLabelText('Chọn tệp CSV');
    const file1 = new File(['content1'], 'file1.csv', { type: 'text/csv' });
    await user.upload(fileInput, file1);

    await user.click(screen.getByRole('button', { name: 'Kiểm tra' }));

    const applyBtn = await screen.findByRole('button', { name: 'Áp dụng' });
    expect(applyBtn).not.toBeDisabled();

    // Upload another file
    const file2 = new File(['content2'], 'file2.csv', { type: 'text/csv' });
    await user.upload(fileInput, file2);

    expect(applyBtn).toBeDisabled();
    expect(screen.queryByText('Tổng kết')).not.toBeInTheDocument();
  });

  it('a 400 response shows the error', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/imports/roster' && init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({
              error: {
                code: 'VALIDATION_ERROR',
                message: 'missing column full_name',
              },
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderImportPage();

    const fileInput = screen.getByLabelText('Chọn tệp CSV');
    const file = new File(['bad-csv'], 'bad.csv', { type: 'text/csv' });
    await user.upload(fileInput, file);

    await user.click(screen.getByRole('button', { name: 'Kiểm tra' }));

    expect(
      await screen.findByText('Dữ liệu không hợp lệ: missing column full_name'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Áp dụng' })).toBeDisabled();
  });

  it('toggle onlyIssues filters out clean rows', async () => {
    const user = userEvent.setup();

    const mixedResult: ImportResult = {
      applied: false,
      summary: {
        rows: 2,
        users_created: 0,
        users_updated: 0,
        users_unchanged: 1,
        groups_created: [],
        memberships_added: 0,
        cards_registered: 0,
        cards_bound: 0,
        errors: 1,
        warnings: 0,
      },
      ignored_columns: [],
      rows: [
        {
          line: 2,
          external_id: 'SV_OK',
          action: 'unchanged',
          groups_added: [],
          card: 'unchanged',
          errors: [],
          warnings: [],
        },
        {
          line: 3,
          external_id: 'SV_BAD',
          action: 'error',
          groups_added: [],
          card: null,
          errors: [{ code: 'INVALID_EXTERNAL_ID', message: 'invalid ID' }],
          warnings: [],
        },
      ],
    };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/imports/roster') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mixedResult),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderImportPage();

    const fileInput = screen.getByLabelText('Chọn tệp CSV');
    const file = new File(['csv'], 'mixed.csv', { type: 'text/csv' });
    await user.upload(fileInput, file);

    await user.click(screen.getByRole('button', { name: 'Kiểm tra' }));

    expect(await screen.findByText('SV_OK')).toBeInTheDocument();
    expect(screen.getByText('SV_BAD')).toBeInTheDocument();

    const toggle = screen.getByLabelText('Chỉ hiện dòng có lỗi hoặc cảnh báo');
    await user.click(toggle);

    expect(screen.queryByText('SV_OK')).not.toBeInTheDocument();
    expect(screen.getByText('SV_BAD')).toBeInTheDocument();
  });
});
