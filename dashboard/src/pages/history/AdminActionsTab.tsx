import React, { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { listAdminActions } from '../../api/endpoints';
import type { AdminAction } from '../../api/types';
import { formatDateTime } from '../../lib/time';
import { errorMessage } from '../../lib/errors';
import { getVnDateString, toVnIso } from './AuditTab';

const ENTITY_TYPE_OPTIONS = [
  { value: '', label: 'Tất cả đối tượng' },
  { value: 'user', label: 'user' },
  { value: 'group', label: 'group' },
  { value: 'card', label: 'card' },
  { value: 'zone', label: 'zone' },
  { value: 'workstation', label: 'workstation' },
  { value: 'workstation_profile', label: 'workstation_profile' },
  { value: 'schedule', label: 'schedule' },
  { value: 'enrollment_request', label: 'enrollment_request' },
  { value: 'admin', label: 'admin' },
  { value: 'roster', label: 'roster' },
  { value: 'ingest_reject', label: 'ingest_reject' },
];

export function AdminActionsTab() {
  const [entityType, setEntityType] = useState('');
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const toggleDetails = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleToday = () => {
    const today = getVnDateString();
    setFromTime(`${today}T00:00`);
    setToTime(`${today}T23:59`);
  };

  const handleSevenDays = () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const fromDate = getVnDateString(sevenDaysAgo);
    const today = getVnDateString();
    setFromTime(`${fromDate}T00:00`);
    setToTime(`${today}T23:59`);
  };

  const handleClearTime = () => {
    setFromTime('');
    setToTime('');
  };

  const filterParams = {
    entity_type: entityType || undefined,
    from: toVnIso(fromTime),
    to: toVnIso(toTime),
  };

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['admin-actions', filterParams],
    queryFn: ({ pageParam }) =>
      listAdminActions({
        ...filterParams,
        cursor: pageParam,
        limit: 50,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  const actions: AdminAction[] = useMemo(() => {
    return data?.pages.flatMap((page) => page.items) ?? [];
  }, [data]);

  return (
    <div className="space-y-4">
      {/* Filters Section */}
      <div className="bg-white p-4 rounded-lg shadow border border-gray-200 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Loại đối tượng */}
          <div>
            <label htmlFor="admin-filter-entity-type" className="block text-xs font-semibold text-gray-700 mb-1">
              Loại đối tượng
            </label>
            <select
              id="admin-filter-entity-type"
              aria-label="Chọn loại đối tượng"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {ENTITY_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Time filters */}
        <div className="pt-2 border-t border-gray-100 flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center space-x-2">
            <label htmlFor="admin-filter-from" className="text-xs font-semibold text-gray-700 whitespace-nowrap">
              Từ:
            </label>
            <input
              id="admin-filter-from"
              type="datetime-local"
              value={fromTime}
              onChange={(e) => setFromTime(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center space-x-2">
            <label htmlFor="admin-filter-to" className="text-xs font-semibold text-gray-700 whitespace-nowrap">
              Đến:
            </label>
            <input
              id="admin-filter-to"
              type="datetime-local"
              value={toTime}
              onChange={(e) => setToTime(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleToday}
              className="px-2.5 py-1 text-xs border border-gray-300 rounded text-gray-700 hover:bg-gray-100"
            >
              Hôm nay
            </button>
            <button
              type="button"
              onClick={handleSevenDays}
              className="px-2.5 py-1 text-xs border border-gray-300 rounded text-gray-700 hover:bg-gray-100"
            >
              7 ngày
            </button>
            {(fromTime || toTime) && (
              <button
                type="button"
                onClick={handleClearTime}
                className="px-2.5 py-1 text-xs text-blue-600 hover:underline"
              >
                Xóa giờ
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error display */}
      {isError && (
        <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200 text-sm">
          {errorMessage(error)}
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="p-8 text-center text-gray-500">Đang tải thao tác quản trị…</div>
      )}

      {/* Main Table */}
      {!isLoading && !isError && (
        <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-gray-600 font-medium">
                <tr>
                  <th className="px-4 py-3 text-left">Lúc</th>
                  <th className="px-4 py-3 text-left">Admin</th>
                  <th className="px-4 py-3 text-left">Hành động</th>
                  <th className="px-4 py-3 text-left">Đối tượng</th>
                  <th className="px-4 py-3 text-right">Chi tiết</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {actions.length > 0 ? (
                  actions.map((act) => {
                    const isExpanded = !!expandedIds[act.id];
                    const entityLabel = `${act.entity_type}${
                      act.entity_id ? ` ${act.entity_id.slice(0, 8)}` : ''
                    }`;

                    return (
                      <React.Fragment key={act.id}>
                        <tr className="hover:bg-gray-50">
                          {/* Lúc */}
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                            {formatDateTime(act.occurred_at)}
                          </td>

                          {/* Admin */}
                          <td className="px-4 py-3 text-gray-900 font-medium whitespace-nowrap">
                            {act.admin?.display_name || act.admin?.username || '—'}
                          </td>

                          {/* Hành động */}
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs bg-gray-100 text-gray-800 px-2 py-0.5 rounded border border-gray-200">
                              {act.action}
                            </span>
                          </td>

                          {/* Đối tượng */}
                          <td className="px-4 py-3 text-gray-700 font-mono text-xs whitespace-nowrap">
                            {entityLabel}
                          </td>

                          {/* Chi tiết button */}
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => toggleDetails(act.id)}
                              className="text-xs text-blue-600 hover:underline font-medium"
                            >
                              {isExpanded ? 'Ẩn chi tiết' : 'Chi tiết'}
                            </button>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr key={`${act.id}-expanded`}>
                            <td colSpan={5} className="bg-gray-50 px-6 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                                <div>
                                  <span className="font-sans font-semibold text-gray-700 block mb-1">
                                    Trước (before):
                                  </span>
                                  <pre className="bg-white p-3 rounded border border-gray-200 overflow-x-auto max-h-60 whitespace-pre-wrap break-words">
                                    {act.before !== undefined && act.before !== null
                                      ? JSON.stringify(act.before, null, 2)
                                      : 'null'}
                                  </pre>
                                </div>
                                <div>
                                  <span className="font-sans font-semibold text-gray-700 block mb-1">
                                    Sau (after):
                                  </span>
                                  <pre className="bg-white p-3 rounded border border-gray-200 overflow-x-auto max-h-60 whitespace-pre-wrap break-words">
                                    {act.after !== undefined && act.after !== null
                                      ? JSON.stringify(act.after, null, 2)
                                      : 'null'}
                                  </pre>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                      Không tìm thấy thao tác quản trị nào
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Tải thêm button */}
          {hasNextPage && (
            <div className="p-4 text-center border-t border-gray-200">
              <button
                type="button"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="px-4 py-2 border border-gray-300 rounded text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                {isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
