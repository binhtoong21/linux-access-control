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
import { formatDateTime } from '../lib/time';

export function IssuesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const initialWorkstationId = searchParams.get('workstation_id') || '';
  const [workstationId, setWorkstationId] = useState(initialWorkstationId);
  const [resolvedFilter, setResolvedFilter] = useState<IngestRejectResolvedFilter>('false');

  const [expandedRecords, setExpandedRecords] = useState<Record<string, boolean>>({});
  const [expandedAlerts, setExpandedAlerts] = useState<Record<string, boolean>>({});

  const [resolvingIds, setResolvingIds] = useState<Record<string, boolean>>({});
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

  const handleResolve = async (id: string) => {
    if (inFlightResolvesRef.current[id]) return;
    inFlightResolvesRef.current[id] = true;
    setResolvingIds((prev) => ({ ...prev, [id]: true }));

    const notePrompt = window.prompt('Ghi chú (không bắt buộc):');
    if (notePrompt === null) {
      inFlightResolvesRef.current[id] = false;
      setResolvingIds((prev) => ({ ...prev, [id]: false }));
      return; // cancelled
    }

    try {
      const trimmed = notePrompt.trim();
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
    } catch (err) {
      inFlightResolvesRef.current[id] = false;
    } finally {
      setResolvingIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header & Machine Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Sự cố</h1>
          <p className="text-sm text-gray-500">
            Bản ghi không lưu được và các cảnh báo từ máy trạm
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <label htmlFor="workstation-filter" className="text-sm font-medium text-gray-700">
            Máy:
          </label>
          <select
            id="workstation-filter"
            aria-label="Chọn máy"
            value={workstationId}
            onChange={(e) => handleWorkstationChange(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Tất cả máy</option>
            {workstations?.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.hostname} ({ws.mqtt_identity})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Section 1: Ingest Rejects */}
      <section className="bg-white rounded-lg shadow border border-gray-200 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">
            Bản ghi máy gửi lên nhưng không lưu được
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Máy đã gửi các mục này nhưng server không áp dụng được; chúng không chặn các mục khác.
            Xem lỗi, xử lý nguyên nhân rồi đánh dấu đã xem.
          </p>
        </div>

        {/* Filter buttons */}
        <div className="flex items-center space-x-2 pt-2">
          <span className="text-sm font-medium text-gray-700">Trạng thái:</span>
          <div className="inline-flex rounded-md shadow-sm">
            <button
              type="button"
              onClick={() => setResolvedFilter('false')}
              className={`px-3 py-1.5 text-xs font-medium rounded-l-md border ${
                resolvedFilter === 'false'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Chưa xem
            </button>
            <button
              type="button"
              onClick={() => setResolvedFilter('true')}
              className={`px-3 py-1.5 text-xs font-medium border-t border-b ${
                resolvedFilter === 'true'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Đã xem
            </button>
            <button
              type="button"
              onClick={() => setResolvedFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-r-md border ${
                resolvedFilter === 'all'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Tất cả
            </button>
          </div>
        </div>

        {/* Rejects Table */}
        {rejectsIsError && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">
            {rejectsError instanceof Error ? rejectsError.message : 'Lỗi tải bản ghi'}
          </div>
        )}

        {rejectsLoading && (
          <div className="p-8 text-center text-gray-500">Đang tải bản ghi…</div>
        )}

        {!rejectsLoading && !rejectsIsError && (
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-gray-600 font-medium">
                <tr>
                  <th className="px-4 py-3 text-left">Nhận lúc</th>
                  <th className="px-4 py-3 text-left">Máy</th>
                  <th className="px-4 py-3 text-left">Lỗi</th>
                  <th className="px-4 py-3 text-left">Dữ liệu</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {rejects.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                      Không có bản ghi nào
                    </td>
                  </tr>
                ) : (
                  rejects.map((reject) => {
                    const isResolved = Boolean(
                      reject.resolved_at || resolvedOverrides[reject.id],
                    );
                    const resolvedAt =
                      reject.resolved_at || resolvedOverrides[reject.id]?.resolved_at;
                    const note = reject.note || resolvedOverrides[reject.id]?.note;

                    return (
                      <tr key={reject.id} className="hover:bg-gray-50 align-top">
                        <td className="px-4 py-3 whitespace-nowrap text-gray-900">
                          {formatDateTime(reject.received_at)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-900 font-mono text-xs">
                          {reject.workstation ? (
                            <Link
                              to={`/workstations/${reject.workstation.id}`}
                              className="text-blue-600 hover:underline"
                            >
                              {reject.workstation.mqtt_identity}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-red-600 font-medium">
                          {reject.error}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => toggleRecord(reject.id)}
                            className="text-xs text-blue-600 hover:underline font-medium"
                          >
                            {expandedRecords[reject.id] ? 'Ẩn dữ liệu' : 'Xem dữ liệu'}
                          </button>
                          {expandedRecords[reject.id] && (
                            <pre className="mt-2 p-2 bg-gray-50 border border-gray-200 rounded text-xs font-mono max-h-60 overflow-auto">
                              {JSON.stringify(reject.raw_record, null, 2)}
                            </pre>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {!isResolved ? (
                            <button
                              type="button"
                              disabled={resolvingIds[reject.id]}
                              onClick={() => handleResolve(reject.id)}
                              className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                            >
                              Đánh dấu đã xem
                            </button>
                          ) : (
                            <span className="text-xs text-gray-600">
                              Đã xem lúc {formatDateTime(resolvedAt)}
                              {note ? ` (${note})` : ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {rejectsHasNextPage && (
          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={() => rejectsFetchNextPage()}
              disabled={rejectsIsFetchingNextPage}
              className="px-4 py-2 border border-gray-300 rounded text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              {rejectsIsFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
            </button>
          </div>
        )}
      </section>

      {/* Section 2: Workstation Alerts */}
      <section className="bg-white rounded-lg shadow border border-gray-200 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Cảnh báo từ máy</h2>
        </div>

        {alertsIsError && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">
            {alertsError instanceof Error ? alertsError.message : 'Lỗi tải cảnh báo'}
          </div>
        )}

        {alertsLoading && (
          <div className="p-8 text-center text-gray-500">Đang tải cảnh báo…</div>
        )}

        {!alertsLoading && !alertsIsError && (
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-gray-600 font-medium">
                <tr>
                  <th className="px-4 py-3 text-left">Lúc</th>
                  <th className="px-4 py-3 text-left">Máy</th>
                  <th className="px-4 py-3 text-left">Loại</th>
                  <th className="px-4 py-3 text-left">Chi tiết</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {alerts.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                      Không có cảnh báo nào
                    </td>
                  </tr>
                ) : (
                  alerts.map((alert) => (
                    <tr key={alert.id} className="hover:bg-gray-50 align-top">
                      <td className="px-4 py-3 whitespace-nowrap text-gray-900">
                        {formatDateTime(alert.occurred_at)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-900 font-mono text-xs">
                        {alert.workstation ? (
                          <Link
                            to={`/workstations/${alert.workstation.id}`}
                            className="text-blue-600 hover:underline"
                          >
                            {alert.workstation.mqtt_identity}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-900 font-medium">
                        {alertKindLabel(alert.kind)}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggleAlertDetail(alert.id)}
                          className="text-xs text-blue-600 hover:underline font-medium"
                        >
                          {expandedAlerts[alert.id] ? 'Ẩn chi tiết' : 'Chi tiết'}
                        </button>
                        {expandedAlerts[alert.id] && (
                          <pre className="mt-2 p-2 bg-gray-50 border border-gray-200 rounded text-xs font-mono max-h-60 overflow-auto">
                            {JSON.stringify(alert.detail, null, 2)}
                          </pre>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {alertsHasNextPage && (
          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={() => alertsFetchNextPage()}
              disabled={alertsIsFetchingNextPage}
              className="px-4 py-2 border border-gray-300 rounded text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              {alertsIsFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
