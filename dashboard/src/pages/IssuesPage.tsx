import React, { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listIngestRejects,
  listWorkstationAlerts,
  listWorkstations,
  resolveIngestReject,
} from '../api/endpoints';
import type {
  IngestReject,
  IngestRejectResolvedFilter,
  WorkstationAlert,
  WorkstationSummary,
} from '../api/types';
import { alertKindLabel } from '../lib/labels';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/time';
import {
  Button,
  ConfirmDialog,
  EmptyRow,
  Field,
  fieldDescribedBy,
  Notice,
  PageHeader,
  selectClass,
  StatusPill,
  Table,
  TD,
  TH,
  THead,
  TR,
} from '../components/ui';

export function IssuesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const initialWorkstationId = searchParams.get('workstation_id') || '';
  const [workstationId, setWorkstationId] = useState(initialWorkstationId);
  const [resolvedFilter, setResolvedFilter] = useState<IngestRejectResolvedFilter>('false');

  const [expandedRecords, setExpandedRecords] = useState<Record<string, boolean>>({});
  const [expandedAlerts, setExpandedAlerts] = useState<Record<string, boolean>>({});

  const [resolvingIds, setResolvingIds] = useState<Record<string, boolean>>({});
  const [resolveTarget, setResolveTarget] = useState<IngestReject | null>(null);
  const [resolvedOverrides, setResolvedOverrides] = useState<
    Record<string, { resolved_at: string; note: string | null }>
  >({});
  const inFlightResolvesRef = useRef<Record<string, boolean>>({});

  // Load workstations for dropdown
  const { data: workstations } = useQuery<WorkstationSummary[]>({
    queryKey: ['workstations'],
    queryFn: () => listWorkstations(),
  });

  const handleWorkstationChange = (newId: string) => {
    setWorkstationId(newId);
    const next = new URLSearchParams(searchParams);
    if (newId) {
      next.set('workstation_id', newId);
    } else {
      next.delete('workstation_id');
    }
    setSearchParams(next, { replace: true });
  };

  // 1. Ingest Rejects Infinite Query
  const {
    data: rejectsData,
    isLoading: rejectsLoading,
    isError: rejectsIsError,
    error: rejectsError,
    hasNextPage: rejectsHasNextPage,
    fetchNextPage: rejectsFetchNextPage,
    isFetchingNextPage: rejectsIsFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['ingest-rejects', workstationId, resolvedFilter],
    queryFn: ({ pageParam }) =>
      listIngestRejects({
        workstation_id: workstationId || undefined,
        resolved: resolvedFilter,
        cursor: pageParam,
        limit: 20,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  const rejects: IngestReject[] = useMemo(() => {
    return rejectsData?.pages.flatMap((page) => page.items) ?? [];
  }, [rejectsData]);

  // 2. Workstation Alerts Infinite Query
  const {
    data: alertsData,
    isLoading: alertsLoading,
    isError: alertsIsError,
    error: alertsError,
    hasNextPage: alertsHasNextPage,
    fetchNextPage: alertsFetchNextPage,
    isFetchingNextPage: alertsIsFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['workstation-alerts', workstationId],
    queryFn: ({ pageParam }) =>
      listWorkstationAlerts({
        workstation_id: workstationId || undefined,
        cursor: pageParam,
        limit: 20,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  const alerts: WorkstationAlert[] = useMemo(() => {
    return alertsData?.pages.flatMap((page) => page.items) ?? [];
  }, [alertsData]);

  const toggleRecord = (id: string) => {
    setExpandedRecords((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleAlertDetail = (id: string) => {
    setExpandedAlerts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleResolve = async (note = '') => {
    if (!resolveTarget) return;
    const id = resolveTarget.id;
    if (inFlightResolvesRef.current[id]) return;
    inFlightResolvesRef.current[id] = true;
    setResolvingIds((prev) => ({ ...prev, [id]: true }));

    try {
      const trimmed = note.trim();
      const res = await resolveIngestReject(id, trimmed ? { note: trimmed } : undefined);
      setResolvedOverrides((prev) => ({
        ...prev,
        [id]: {
          resolved_at: res.resolved_at || new Date().toISOString(),
          note: res.note || (trimmed || null),
        },
      }));
      await queryClient.invalidateQueries({ queryKey: ['ingest-rejects'] });
      await queryClient.invalidateQueries({ queryKey: ['workstations'] });
      setResolveTarget(null);
    } catch (err) {
      inFlightResolvesRef.current[id] = false;
      throw err; // the dialog shows the real reason via errorMessage
    } finally {
      setResolvingIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header & Machine Filter */}
      <PageHeader
        title="Sự cố"
        description="Bản ghi không lưu được và các cảnh báo từ máy trạm"
        actions={<Field label="Máy:" htmlFor="workstation-filter">
          <select
            id="workstation-filter"
            aria-describedby={fieldDescribedBy('workstation-filter', {})}
            aria-label="Chọn máy"
            value={workstationId}
            onChange={(e) => handleWorkstationChange(e.target.value)}
            className={`w-full ${selectClass}`}
          >
            <option value="">Tất cả máy</option>
            {workstations?.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.hostname} ({ws.mqtt_identity})
              </option>
            ))}
          </select>
        </Field>}
      />

      {/* Section 1: Ingest Rejects */}
      <section className="bg-surface rounded border border-line p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-ink">
            Bản ghi máy gửi lên nhưng không lưu được
          </h2>
          <p className="text-sm text-ink-muted mt-1">
            Máy đã gửi các mục này nhưng server không áp dụng được; chúng không chặn các mục khác.
            Xem lỗi, xử lý nguyên nhân rồi đánh dấu đã xem.
          </p>
        </div>

        {/* Filter buttons */}
        <div className="flex items-center space-x-2 pt-2">
          <span className="text-sm font-medium text-ink">Trạng thái:</span>
          <div className="inline-flex gap-2">
            <Button
              type="button"
              onClick={() => setResolvedFilter('false')}
              size="sm"
              variant={resolvedFilter === 'false' ? 'primary' : 'secondary'}
            >
              Chưa xem
            </Button>
            <Button
              type="button"
              onClick={() => setResolvedFilter('true')}
              size="sm"
              variant={resolvedFilter === 'true' ? 'primary' : 'secondary'}
            >
              Đã xem
            </Button>
            <Button
              type="button"
              onClick={() => setResolvedFilter('all')}
              size="sm"
              variant={resolvedFilter === 'all' ? 'primary' : 'secondary'}
            >
              Tất cả
            </Button>
          </div>
        </div>

        {/* Rejects Table */}
        {rejectsIsError && (
          <Notice tone="danger">
            {rejectsError instanceof Error ? rejectsError.message : 'Lỗi tải bản ghi'}
          </Notice>
        )}

        {rejectsLoading && (
          <Notice tone="info">Đang tải bản ghi…</Notice>
        )}

        {!rejectsLoading && !rejectsIsError && (
          <Table>
            <THead>
              <TR>
                <TH className="text-left">Nhận lúc</TH>
                <TH className="text-left">Máy</TH>
                <TH className="text-left">Lỗi</TH>
                <TH className="text-left">Dữ liệu</TH>
                <TH className="text-right">Thao tác</TH>
              </TR>
            </THead>
            <tbody>
              {rejects.length === 0 ? (
                <EmptyRow colSpan={5}>Không có bản ghi nào</EmptyRow>
              ) : (
                rejects.map((reject) => {
                  const isResolved = Boolean(
                    reject.resolved_at || resolvedOverrides[reject.id],
                  );
                  const resolvedAt =
                    reject.resolved_at || resolvedOverrides[reject.id]?.resolved_at;
                  const note = reject.note || resolvedOverrides[reject.id]?.note;

                  return (
                    <TR key={reject.id} interactive>
                      <TD className="whitespace-nowrap text-ink">
                        {formatDateTime(reject.received_at)}
                      </TD>
                      <TD className="whitespace-nowrap text-ink font-mono text-xs">
                        {reject.workstation ? (
                          <Link
                            to={`/workstations/${reject.workstation.id}`}
                            className="text-accent hover:underline"
                          >
                            {reject.workstation.mqtt_identity}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TD>
                      <TD className="text-danger font-medium">
                        {reject.error}
                      </TD>
                      <TD>
                        <Button
                          variant="quiet"
                          size="sm"
                          type="button"
                          onClick={() => toggleRecord(reject.id)}
                        >
                          {expandedRecords[reject.id] ? 'Ẩn dữ liệu' : 'Xem dữ liệu'}
                        </Button>
                        {expandedRecords[reject.id] && (
                          <pre className="mt-2 p-2 bg-canvas border border-line rounded text-xs font-mono max-h-60 overflow-auto">
                            {JSON.stringify(reject.raw_record, null, 2)}
                          </pre>
                        )}
                      </TD>
                      <TD className="text-right whitespace-nowrap">
                        {!isResolved ? (
                          <Button
                            type="button"
                            disabled={resolvingIds[reject.id]}
                            onClick={() => setResolveTarget(reject)}
                          >
                            Đánh dấu đã xem
                          </Button>
                        ) : (
                          <StatusPill tone="ok">
                            Đã xem lúc {formatDateTime(resolvedAt)}
                            {note ? ` (${note})` : ''}
                          </StatusPill>
                        )}
                      </TD>
                    </TR>
                  );
                })
              )}
            </tbody>
          </Table>
        )}

        {rejectsHasNextPage && (
          <div className="pt-2 text-center">
            <Button
              type="button"
              onClick={() => rejectsFetchNextPage()}
              disabled={rejectsIsFetchingNextPage}
            >
              {rejectsIsFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
            </Button>
          </div>
        )}
      </section>

      {/* Section 2: Workstation Alerts */}
      <section className="bg-surface rounded border border-line p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Cảnh báo từ máy</h2>
        </div>

        {alertsIsError && (
          <Notice tone="danger">
            {alertsError instanceof Error ? alertsError.message : 'Lỗi tải cảnh báo'}
          </Notice>
        )}

        {alertsLoading && (
          <Notice tone="info">Đang tải cảnh báo…</Notice>
        )}

        {!alertsLoading && !alertsIsError && (
          <Table>
            <THead>
              <TR>
                <TH className="text-left">Lúc</TH>
                <TH className="text-left">Máy</TH>
                <TH className="text-left">Loại</TH>
                <TH className="text-left">Chi tiết</TH>
              </TR>
            </THead>
            <tbody>
              {alerts.length === 0 ? (
                <EmptyRow colSpan={4}>Không có cảnh báo nào</EmptyRow>
              ) : (
                alerts.map((alert) => (
                  <TR key={alert.id} interactive>
                    <TD className="whitespace-nowrap text-ink">
                      {formatDateTime(alert.occurred_at)}
                    </TD>
                    <TD className="whitespace-nowrap text-ink font-mono text-xs">
                      {alert.workstation ? (
                        <Link
                          to={`/workstations/${alert.workstation.id}`}
                          className="text-accent hover:underline"
                        >
                          {alert.workstation.mqtt_identity}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD className="text-ink font-medium">
                      <StatusPill tone={alert.kind === 'edge_db_recovered' ? 'warn' : 'danger'}>
                        {alertKindLabel(alert.kind)}
                      </StatusPill>
                    </TD>
                    <TD>
                      <Button
                        variant="quiet"
                        size="sm"
                        type="button"
                        onClick={() => toggleAlertDetail(alert.id)}
                      >
                        {expandedAlerts[alert.id] ? 'Ẩn chi tiết' : 'Chi tiết'}
                      </Button>
                      {expandedAlerts[alert.id] && (
                        <pre className="mt-2 p-2 bg-canvas border border-line rounded text-xs font-mono max-h-60 overflow-auto">
                          {JSON.stringify(alert.detail, null, 2)}
                        </pre>
                      )}
                    </TD>
                  </TR>
                ))
              )}
            </tbody>
          </Table>
        )}

        {alertsHasNextPage && (
          <div className="pt-2 text-center">
            <Button
              type="button"
              onClick={() => alertsFetchNextPage()}
              disabled={alertsIsFetchingNextPage}
            >
              {alertsIsFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
            </Button>
          </div>
        )}
      </section>
      <ConfirmDialog
        open={resolveTarget !== null}
        title={`Đánh dấu đã xem bản ghi ${resolveTarget?.entry_id ?? ''}?`}
        message="Xem lỗi, xử lý nguyên nhân rồi đánh dấu đã xem. Bản ghi sẽ được ghi nhận là đã xem."
        confirmLabel="Đánh dấu đã xem"
        input={{ label: 'Ghi chú (không bắt buộc):' }}
        onConfirm={handleResolve}
        onCancel={() => setResolveTarget(null)}
      />
    </div>
  );
}
