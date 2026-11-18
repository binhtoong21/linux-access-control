import React, { useId, useMemo, useRef, useState } from 'react';
import {
  Button,
  ConfirmDialog,
  EmptyRow,
  Field,
  inputClass,
  Notice,
  PageHeader,
  StatusPill,
  Table,
  THead,
  TH,
  TR,
  TD,
} from '../components/ui';
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
  const [applyText, setApplyText] = useState<string | null>(null);

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
    setApplyText(null);
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
    if (inFlightRef.current || !canApply || !result || applyText !== csvText) return;
    inFlightRef.current = true;
    setIsSubmitting(true);
    setInFlightAction('apply');

    try {
      const res = await importRoster(csvText, true);
      setResult(res);
      if (res.applied) {
        setApplyText(null);
        setAppliedMessage('Đã áp dụng.');
        setStatusError(null);
        await queryClient.invalidateQueries({ queryKey: ['users'] });
        await queryClient.invalidateQueries({ queryKey: ['groups'] });
        await queryClient.invalidateQueries({ queryKey: ['cards'] });
      } else {
        // The server refused (data changed since the check): close the dialog and show the new per-row errors on the page.
        setApplyText(null);
        setAppliedMessage(null);
        setStatusError('Không áp dụng được: dữ liệu đã thay đổi từ lần kiểm tra, xem các lỗi bên dưới.');
      }
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
      <PageHeader title="Nhập danh sách từ CSV" />

      <div className="bg-surface p-4 rounded border border-line space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">Hướng dẫn định dạng tệp</h2>
          <a
            href="#download-template"
            onClick={handleDownloadTemplate}
            className="text-sm text-accent hover:underline font-medium"
          >
            Tải tệp mẫu
          </a>
        </div>
        <p className="text-sm text-ink-muted">
          Các cột:{' '}
          <code className="bg-canvas px-1 py-0.5 rounded text-ink font-mono text-xs">
            external_id, full_name, email, groups, card_uid
          </code>{' '}
          (hai cột đầu bắt buộc;{' '}
          <code className="bg-canvas px-1 py-0.5 rounded text-ink font-mono text-xs">
            groups
          </code>{' '}
          phân tách bằng dấu chấm phẩy{' '}
          <code className="bg-canvas px-1 py-0.5 rounded text-ink font-mono text-xs">
            ;
          </code>
          ; tệp lưu định dạng CSV UTF-8).
        </p>
        <ul className="text-sm text-ink-muted list-disc list-inside space-y-1">
          <li>Chạy lại cùng tệp không tạo trùng.</li>
          <li>Chỉ thêm vào nhóm, không bỏ ai khỏi nhóm.</li>
          <li>Thẻ đang thuộc người khác sẽ báo lỗi, không bị chuyển.</li>
          <li>Người đã vô hiệu hóa không được kích hoạt lại.</li>
        </ul>
      </div>

      <div className="bg-surface p-4 rounded border border-line space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <Field htmlFor={fileInputId} label="Chọn tệp CSV">
            <input
              id={fileInputId}
              type="file"
              accept=".csv,text/csv"
              disabled={isSubmitting}
              onChange={handleFileChange}
              className={`w-full ${inputClass}`}
            />
          </Field>
          {fileName && (
            <div className="text-sm text-ink self-end pb-2">
              Tệp đã chọn: <span className="font-medium text-ink">{fileName}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button
            variant="secondary"
            type="button"
            onClick={handleCheck}
            disabled={isSubmitting || !csvText}
          >
            {isSubmitting && inFlightAction === 'check' ? 'Đang kiểm tra…' : 'Kiểm tra'}
          </Button>
          <Button
            variant="primary"
            type="button"
            onClick={() => setApplyText(csvText)}
            disabled={!canApply}
          >
            {isSubmitting && inFlightAction === 'apply' ? 'Đang áp dụng…' : 'Áp dụng'}
          </Button>
        </div>
      </div>

      {statusError && (
        <Notice tone="danger">{statusError}</Notice>
      )}

      {appliedMessage && (
        <Notice tone="ok">{appliedMessage}</Notice>
      )}

      {result && (
        <div className="space-y-4">
          <div className="bg-surface p-4 rounded border border-line space-y-3">
            <h2 className="text-base font-semibold text-ink">Tổng kết</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-sm">
              <div className="bg-canvas p-2.5 rounded border border-line">
                <div className="text-ink-muted text-xs">Số dòng</div>
                <div className="text-base font-semibold text-ink">{result.summary.rows}</div>
              </div>
              <div className="bg-canvas p-2.5 rounded border border-line">
                <div className="text-ink-muted text-xs">Tạo mới</div>
                <div className="text-base font-semibold text-ok">
                  {result.summary.users_created}
                </div>
              </div>
              <div className="bg-canvas p-2.5 rounded border border-line">
                <div className="text-ink-muted text-xs">Cập nhật</div>
                <div className="text-base font-semibold text-accent">
                  {result.summary.users_updated}
                </div>
              </div>
              <div className="bg-canvas p-2.5 rounded border border-line">
                <div className="text-ink-muted text-xs">Không đổi</div>
                <div className="text-base font-semibold text-ink">
                  {result.summary.users_unchanged}
                </div>
              </div>
              <div className="bg-canvas p-2.5 rounded border border-line">
                <div className="text-ink-muted text-xs">Nhóm mới</div>
                <div
                  className="text-base font-semibold text-ink truncate"
                  title={result.summary.groups_created.join(', ')}
                >
                  {result.summary.groups_created.length > 0
                    ? result.summary.groups_created.join(', ')
                    : '—'}
                </div>
              </div>
              <div className="bg-canvas p-2.5 rounded border border-line">
                <div className="text-ink-muted text-xs">Thêm vào nhóm</div>
                <div className="text-base font-semibold text-ink">
                  {result.summary.memberships_added}
                </div>
              </div>
              <div className="bg-canvas p-2.5 rounded border border-line">
                <div className="text-ink-muted text-xs">Thẻ mới</div>
                <div className="text-base font-semibold text-ink">
                  {result.summary.cards_registered}
                </div>
              </div>
              <div className="bg-canvas p-2.5 rounded border border-line">
                <div className="text-ink-muted text-xs">Thẻ được gắn</div>
                <div className="text-base font-semibold text-ink">
                  {result.summary.cards_bound}
                </div>
              </div>
              <div className="bg-canvas p-2.5 rounded border border-line">
                <div className="text-ink-muted text-xs">Lỗi</div>
                <div
                  className={`text-base font-semibold ${result.summary.errors > 0 ? 'text-danger' : 'text-ink'
                    }`}
                >
                  {result.summary.errors}
                </div>
              </div>
              <div className="bg-canvas p-2.5 rounded border border-line">
                <div className="text-ink-muted text-xs">Cảnh báo</div>
                <div
                  className={`text-base font-semibold ${result.summary.warnings > 0 ? 'text-warn' : 'text-ink'
                    }`}
                >
                  {result.summary.warnings}
                </div>
              </div>
            </div>

            {result.ignored_columns && result.ignored_columns.length > 0 && (
              <Notice tone="warn">
                Cột bị bỏ qua: {result.ignored_columns.join(', ')}
              </Notice>
            )}
          </div>

          <div className="bg-surface rounded border border-line overflow-hidden">
            <div className="p-4 border-b border-line flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">Chi tiết các dòng</h2>
              <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyIssues}
                  onChange={(e) => setOnlyIssues(e.target.checked)}
                  className="h-4 w-4 rounded border-control accent-accent focus:ring-accent"
                />
                <span>Chỉ hiện dòng có lỗi hoặc cảnh báo</span>
              </label>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH className="text-left">Dòng</TH>
                    <TH className="text-left">Mã</TH>
                    <TH className="text-left">Kết quả</TH>
                    <TH className="text-left">Nhóm thêm</TH>
                    <TH className="text-left">Thẻ</TH>
                    <TH className="text-left">Ghi chú</TH>
                  </TR>
                </THead>
                <tbody>
                  {displayedRows.length > 0 ? (
                    displayedRows.map((row) => (
                      <TR key={row.line} className="hover:bg-canvas">
                        <TD className="font-medium text-ink">{row.line}</TD>
                        <TD className="text-ink font-mono text-xs">
                          {row.external_id || '—'}
                        </TD>
                        <TD>
                          <StatusPill tone={row.action === 'create' ? 'ok' : row.action === 'update' ? 'info' : row.action === 'error' ? 'danger' : 'neutral'}>
                            {renderActionText(row.action)}
                          </StatusPill>
                        </TD>
                        <TD className="text-ink">
                          {row.groups_added.length > 0 ? row.groups_added.join(', ') : '—'}
                        </TD>
                        <TD><StatusPill tone={row.card === 'register' || row.card === 'bind' ? 'ok' : 'neutral'}>{renderCardText(row.card)}</StatusPill></TD>
                        <TD className="text-sm">
                          {row.errors.length === 0 && row.warnings.length === 0 ? (
                            <span className="text-ink-muted">—</span>
                          ) : (
                            <div className="space-y-1">
                              {row.errors.map((err, idx) => (
                                <Notice key={`err-${idx}`} tone="danger">
                                  {err.message}
                                </Notice>
                              ))}
                              {row.warnings.map((warn, idx) => (
                                <Notice key={`warn-${idx}`} tone="warn">
                                  {warn.message}
                                </Notice>
                              ))}
                            </div>
                          )}
                        </TD>
                      </TR>
                    ))
                  ) : (
                    <EmptyRow colSpan={6}>
                      {onlyIssues
                        ? 'Không có dòng nào có lỗi hoặc cảnh báo'
                        : 'Không có dữ liệu'}
                    </EmptyRow>
                  )}
                </tbody>
              </Table>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={applyText !== null}
        title={`Áp dụng tệp ${fileName}?`}
        message={`Áp dụng ${result?.summary.rows ?? 0} dòng? Thay đổi có hiệu lực tại máy sau khi máy nhận dữ liệu mới.`}
        confirmLabel="Áp dụng"
        onCancel={() => setApplyText(null)}
        onConfirm={handleApply}
      />
    </div>
  );
}
