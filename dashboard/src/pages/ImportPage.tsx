import React, { useId, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { importRoster } from '../api/endpoints';
import type { CardAction, ImportResult, RowAction } from '../api/types';
import { errorMessage } from '../lib/errors';

export function buildCsvTemplate(): string {
  return '\uFEFFexternal_id,full_name,email,groups,card_uid\nSV001,Nguyễn Văn A,a@example.com,Lớp A;CLB B,\nSV002,Trần Thị B,,Lớp A,04A32B1C5D6E80\n';
}

export function hasApplicableChanges(result: ImportResult): boolean {
  return result.rows.some(
    (row) =>
      row.action !== 'unchanged' ||
      (row.card !== null && row.card !== 'unchanged') ||
      row.groups_added.length > 0,
  );
}

function renderActionText(action: RowAction): string {
  switch (action) {
    case 'create':
      return 'Tạo mới';
    case 'update':
      return 'Cập nhật';
    case 'unchanged':
      return 'Không đổi';
    case 'error':
      return 'Lỗi';
  }
}

function renderCardText(card: CardAction): string {
  switch (card) {
    case 'register':
      return 'Đăng ký mới';
    case 'bind':
      return 'Gắn';
    case 'unchanged':
      return 'Không đổi';
    default:
      return '—';
  }
}

export function ImportPage() {
  const queryClient = useQueryClient();
  const fileInputId = useId();

  const [fileName, setFileName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [lastCheckedText, setLastCheckedText] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inFlightAction, setInFlightAction] = useState<'check' | 'apply' | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [appliedMessage, setAppliedMessage] = useState<string | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);

  const inFlightRef = useRef(false);
  // Each file pick gets a number; a read that finishes after a newer pick is ignored.
  const readGenRef = useRef(0);

  const handleDownloadTemplate = (e: React.MouseEvent) => {
    e.preventDefault();
    const blob = new Blob([buildCsvTemplate()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mau-nhap-danh-sach.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const gen = ++readGenRef.current;
    setCsvText(''); // nothing can be checked until the new file has been read
    setResult(null);
    setLastCheckedText(null);
    setStatusError(null);
    setAppliedMessage(null);

    const file = e.target.files?.[0];
    if (!file) {
      setFileName('');
      setCsvText('');
      return;
    }

    setFileName(file.name);
    try {
      if (typeof file.text === 'function') {
        const text = await file.text();
        if (gen !== readGenRef.current) return;
        setCsvText(text);
      } else {
        const text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsText(file);
        });
        if (gen !== readGenRef.current) return;
        setCsvText(text);
      }
    } catch (e) {
      if (gen !== readGenRef.current) return;
      console.error('File read error:', e);
      setStatusError('Không thể đọc tệp đã chọn');
      setCsvText('');
    }
  };

  const handleCheck = async () => {
    if (inFlightRef.current || !csvText) return;
    inFlightRef.current = true;
    setIsSubmitting(true);
    setInFlightAction('check');
    setStatusError(null);
    setAppliedMessage(null);

    try {
      const res = await importRoster(csvText, false);
      setResult(res);
      setLastCheckedText(csvText);
    } catch (err) {
      setResult(null);
      setLastCheckedText(null);
      setStatusError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
      setInFlightAction(null);
      inFlightRef.current = false;
    }
  };

  const canApply = Boolean(
    result &&
      lastCheckedText === csvText &&
      result.summary.errors === 0 &&
      hasApplicableChanges(result) &&
      !result.applied &&
      !isSubmitting,
  );

  const handleApply = async () => {
    if (inFlightRef.current || !canApply || !result) return;
    inFlightRef.current = true;
    setIsSubmitting(true);
    setInFlightAction('apply');

    try {
      const confirmed = window.confirm(
        `Áp dụng ${result.summary.rows} dòng? Thay đổi có hiệu lực tại máy sau khi máy nhận dữ liệu mới.`,
      );
      if (!confirmed) {
        setIsSubmitting(false);
        setInFlightAction(null);
        inFlightRef.current = false;
        return;
      }

      const res = await importRoster(csvText, true);
      setResult(res);
      if (res.applied) {
        setAppliedMessage('Đã áp dụng.');
        setStatusError(null);
        await queryClient.invalidateQueries({ queryKey: ['users'] });
        await queryClient.invalidateQueries({ queryKey: ['groups'] });
        await queryClient.invalidateQueries({ queryKey: ['cards'] });
      } else {
        setAppliedMessage(null);
        setStatusError(
          'Không áp dụng được: dữ liệu đã thay đổi từ lần kiểm tra, xem các lỗi bên dưới.',
        );
      }
    } catch (err) {
      setStatusError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
      setInFlightAction(null);
      inFlightRef.current = false;
    }
  };

  const displayedRows = useMemo(() => {
    if (!result) return [];
    if (!onlyIssues) return result.rows;
    return result.rows.filter(
      (row) => row.action === 'error' || row.errors.length > 0 || row.warnings.length > 0,
    );
  }, [result, onlyIssues]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl font-bold text-gray-900">Nhập danh sách từ CSV</h1>
      </div>

      <div className="bg-white p-4 rounded-lg shadow border border-gray-200 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-800">Hướng dẫn định dạng tệp</h2>
          <a
            href="#download-template"
            onClick={handleDownloadTemplate}
            className="text-sm text-blue-600 hover:underline font-medium"
          >
            Tải tệp mẫu
          </a>
        </div>
        <p className="text-sm text-gray-600">
          Các cột:{' '}
          <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-800 font-mono text-xs">
            external_id, full_name, email, groups, card_uid
          </code>{' '}
          (hai cột đầu bắt buộc;{' '}
          <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-800 font-mono text-xs">
            groups
          </code>{' '}
          phân tách bằng dấu chấm phẩy{' '}
          <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-800 font-mono text-xs">
            ;
          </code>
          ; tệp lưu định dạng CSV UTF-8).
        </p>
        <ul className="text-sm text-gray-600 list-disc list-inside space-y-1">
          <li>Chạy lại cùng tệp không tạo trùng.</li>
          <li>Chỉ thêm vào nhóm, không bỏ ai khỏi nhóm.</li>
          <li>Thẻ đang thuộc người khác sẽ báo lỗi, không bị chuyển.</li>
          <li>Người đã vô hiệu hóa không được kích hoạt lại.</li>
        </ul>
      </div>

      <div className="bg-white p-4 rounded-lg shadow border border-gray-200 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <label htmlFor={fileInputId} className="block text-sm font-medium text-gray-700 mb-1">
              Chọn tệp CSV
            </label>
            <input
              id={fileInputId}
              type="file"
              accept=".csv,text/csv"
              disabled={isSubmitting}
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50"
            />
          </div>
          {fileName && (
            <div className="text-sm text-gray-700 self-end pb-2">
              Tệp đã chọn: <span className="font-medium text-gray-900">{fileName}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={handleCheck}
            disabled={isSubmitting || !csvText}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting && inFlightAction === 'check' ? 'Đang kiểm tra…' : 'Kiểm tra'}
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!canApply}
            className="px-4 py-2 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {isSubmitting && inFlightAction === 'apply' ? 'Đang áp dụng…' : 'Áp dụng'}
          </button>
        </div>
      </div>

      {statusError && (
        <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200 text-sm">
          {statusError}
        </div>
      )}

      {appliedMessage && (
        <div className="p-4 bg-green-50 text-green-700 rounded border border-green-200 text-sm font-medium">
          {appliedMessage}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-lg shadow border border-gray-200 space-y-3">
            <h2 className="text-sm font-semibold text-gray-800">Tổng kết</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-sm">
              <div className="bg-gray-50 p-2.5 rounded border border-gray-100">
                <div className="text-gray-500 text-xs">Số dòng</div>
                <div className="text-base font-semibold text-gray-900">{result.summary.rows}</div>
              </div>
              <div className="bg-gray-50 p-2.5 rounded border border-gray-100">
                <div className="text-gray-500 text-xs">Tạo mới</div>
                <div className="text-base font-semibold text-green-700">
                  {result.summary.users_created}
                </div>
              </div>
              <div className="bg-gray-50 p-2.5 rounded border border-gray-100">
                <div className="text-gray-500 text-xs">Cập nhật</div>
                <div className="text-base font-semibold text-blue-700">
                  {result.summary.users_updated}
                </div>
              </div>
              <div className="bg-gray-50 p-2.5 rounded border border-gray-100">
                <div className="text-gray-500 text-xs">Không đổi</div>
                <div className="text-base font-semibold text-gray-700">
                  {result.summary.users_unchanged}
                </div>
              </div>
              <div className="bg-gray-50 p-2.5 rounded border border-gray-100">
                <div className="text-gray-500 text-xs">Nhóm mới</div>
                <div
                  className="text-sm font-semibold text-gray-900 truncate"
                  title={result.summary.groups_created.join(', ')}
                >
                  {result.summary.groups_created.length > 0
                    ? result.summary.groups_created.join(', ')
                    : '—'}
                </div>
              </div>
              <div className="bg-gray-50 p-2.5 rounded border border-gray-100">
                <div className="text-gray-500 text-xs">Thêm vào nhóm</div>
                <div className="text-base font-semibold text-gray-900">
                  {result.summary.memberships_added}
                </div>
              </div>
              <div className="bg-gray-50 p-2.5 rounded border border-gray-100">
                <div className="text-gray-500 text-xs">Thẻ mới</div>
                <div className="text-base font-semibold text-gray-900">
                  {result.summary.cards_registered}
                </div>
              </div>
              <div className="bg-gray-50 p-2.5 rounded border border-gray-100">
                <div className="text-gray-500 text-xs">Thẻ được gắn</div>
                <div className="text-base font-semibold text-gray-900">
                  {result.summary.cards_bound}
                </div>
              </div>
              <div className="bg-gray-50 p-2.5 rounded border border-gray-100">
                <div className="text-gray-500 text-xs">Lỗi</div>
                <div
                  className={`text-base font-semibold ${
                    result.summary.errors > 0 ? 'text-red-600' : 'text-gray-900'
                  }`}
                >
                  {result.summary.errors}
                </div>
              </div>
              <div className="bg-gray-50 p-2.5 rounded border border-gray-100">
                <div className="text-gray-500 text-xs">Cảnh báo</div>
                <div
                  className={`text-base font-semibold ${
                    result.summary.warnings > 0 ? 'text-amber-600' : 'text-gray-900'
                  }`}
                >
                  {result.summary.warnings}
                </div>
              </div>
            </div>

            {result.ignored_columns && result.ignored_columns.length > 0 && (
              <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
                Cột bị bỏ qua: {result.ignored_columns.join(', ')}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">Chi tiết các dòng</h2>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyIssues}
                  onChange={(e) => setOnlyIssues(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Chỉ hiện dòng có lỗi hoặc cảnh báo</span>
              </label>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-gray-600 font-medium">
                  <tr>
                    <th className="px-4 py-3 text-left">Dòng</th>
                    <th className="px-4 py-3 text-left">Mã</th>
                    <th className="px-4 py-3 text-left">Kết quả</th>
                    <th className="px-4 py-3 text-left">Nhóm thêm</th>
                    <th className="px-4 py-3 text-left">Thẻ</th>
                    <th className="px-4 py-3 text-left">Ghi chú</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {displayedRows.length > 0 ? (
                    displayedRows.map((row) => (
                      <tr key={row.line} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-700">{row.line}</td>
                        <td className="px-4 py-3 text-gray-900 font-mono text-xs">
                          {row.external_id || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                              row.action === 'create'
                                ? 'bg-green-100 text-green-800'
                                : row.action === 'update'
                                ? 'bg-blue-100 text-blue-800'
                                : row.action === 'error'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {renderActionText(row.action)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {row.groups_added.length > 0 ? row.groups_added.join(', ') : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{renderCardText(row.card)}</td>
                        <td className="px-4 py-3 text-sm">
                          {row.errors.length === 0 && row.warnings.length === 0 ? (
                            <span className="text-gray-400">—</span>
                          ) : (
                            <div className="space-y-1">
                              {row.errors.map((err, idx) => (
                                <div key={`err-${idx}`} className="text-red-600 font-medium">
                                  {err.message}
                                </div>
                              ))}
                              {row.warnings.map((warn, idx) => (
                                <div key={`warn-${idx}`} className="text-amber-600">
                                  {warn.message}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                        {onlyIssues
                          ? 'Không có dòng nào có lỗi hoặc cảnh báo'
                          : 'Không có dữ liệu'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
