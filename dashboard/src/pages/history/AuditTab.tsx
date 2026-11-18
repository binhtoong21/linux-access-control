import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  getAuditLog,
  getUser,
  listAuditLogs,
  listWorkstations,
  listZones,
} from '../../api/endpoints';
import type { AuditLog, User, WorkstationSummary, Zone } from '../../api/types';
import { outcomeLabel, reasonLabel } from '../../lib/labels';
import { formatDateTime } from '../../lib/time';
import { errorMessage } from '../../lib/errors';
import { UserPicker } from '../../components/UserPicker';

export function toVnIso(datetimeLocal: string): string | undefined {
  if (!datetimeLocal) return undefined;
  if (datetimeLocal.includes('+') || datetimeLocal.endsWith('Z')) return datetimeLocal;
  const parts = datetimeLocal.split(':');
  if (parts.length === 2) {
    return `${datetimeLocal}:00+07:00`;
  }
  return `${datetimeLocal}+07:00`;
}

export function getVnDateString(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

const REASON_OPTIONS = [
  { value: '', label: 'Tất cả lý do' },
  { value: 'unknown_card', label: 'Thẻ chưa đăng ký (unknown_card)' },
  { value: 'card_disabled', label: 'Thẻ bị khóa (card_disabled)' },
  { value: 'user_inactive', label: 'Người dùng bị vô hiệu hóa (user_inactive)' },
  { value: 'no_schedule', label: 'Không có lịch ở máy này (no_schedule)' },
  { value: 'out_of_schedule', label: 'Ngoài giờ được phép (out_of_schedule)' },
  { value: 'data_stale', label: 'Dữ liệu trên máy hết hạn (data_stale)' },
  { value: 'workstation_busy', label: 'Máy đang có người dùng (workstation_busy)' },
  { value: 'ambiguous_profile', label: 'Lịch mâu thuẫn profile (ambiguous_profile)' },
  { value: 'profile_disabled', label: 'Profile bị tắt (profile_disabled)' },
  { value: 'profile_not_found', label: 'Máy không có profile (profile_not_found)' },
  { value: 'already_active', label: 'Đang trong phiên của mình (already_active)' },
  { value: 'granted', label: 'Hợp lệ (granted)' },
  { value: 'invalid_uid', label: 'UID đọc được không hợp lệ (invalid_uid)' },
  { value: 'reader_error', label: 'Lỗi đầu đọc (reader_error)' },
  { value: 'internal_error', label: 'Lỗi nội bộ của máy (internal_error)' },
];

export function AuditTab({
  initialWorkstationId,
  initialUserId,
}: {
  initialWorkstationId?: string;
  initialUserId?: string;
}) {
  const [workstationId, setWorkstationId] = useState(initialWorkstationId || '');
  const [zoneId, setZoneId] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userIdFilter, setUserIdFilter] = useState(initialUserId || '');
  const [outcome, setOutcome] = useState('');
  const [reason, setReason] = useState('');
  const [cardUid, setCardUid] = useState('');
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');

  // UID reveal state
  const [uids, setUids] = useState<Record<string, string>>({});
  const [loadingUids, setLoadingUids] = useState<Record<string, boolean>>({});

  // Load workstations & zones for filter dropdowns
  const { data: workstations } = useQuery<WorkstationSummary[]>({
    queryKey: ['workstations'],
    queryFn: () => listWorkstations(),
  });

  const { data: zones } = useQuery<Zone[]>({
    queryKey: ['zones'],
    queryFn: () => listZones(),
  });

  // If initialUserId provided, resolve user details for chip display
  const { data: fetchedUser } = useQuery<User>({
    queryKey: ['user', userIdFilter],
    queryFn: () => getUser(userIdFilter),
    enabled: !!userIdFilter && !selectedUser,
  });

  useEffect(() => {
    if (fetchedUser && !selectedUser) {
      setSelectedUser(fetchedUser);
    }
  }, [fetchedUser, selectedUser]);

  const handleSelectUser = (u: User) => {
    setSelectedUser(u);
    setUserIdFilter(u.id);
  };

  const handleClearUser = () => {
    setSelectedUser(null);
    setUserIdFilter('');
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

  // Infinite query for audit logs
  const filterParams = {
    workstation_id: workstationId || undefined,
    zone_id: zoneId || undefined,
    user_id: selectedUser ? selectedUser.id : userIdFilter || undefined,
    outcome: outcome || undefined,
    reason: reason || undefined,
    card_uid: cardUid.trim() || undefined,
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
    queryKey: ['audit-logs', filterParams],
    queryFn: ({ pageParam }) =>
      listAuditLogs({
        ...filterParams,
        cursor: pageParam,
        limit: 50,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  const logs: AuditLog[] = useMemo(() => {
    return data?.pages.flatMap((page) => page.items) ?? [];
  }, [data]);

  const handleFetchUid = async (id: string) => {
    setLoadingUids((prev) => ({ ...prev, [id]: true }));
    try {
      const detail = await getAuditLog(id);
      if (detail.card_uid) {
        setUids((prev) => ({ ...prev, [id]: detail.card_uid! }));
      }
    } finally {
      setLoadingUids((prev) => ({ ...prev, [id]: false }));
    }
  };

  const getOutcomeBadge = (out: string) => {
    switch (out) {
      case 'granted':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
            {outcomeLabel(out)}
          </span>
        );
      case 'denied':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
            {outcomeLabel(out)}
          </span>
        );
      case 'noop':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
            {outcomeLabel(out)}
          </span>
        );
      case 'error':
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
            {outcomeLabel(out)}
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters Section */}
      <div className="bg-white p-4 rounded-lg shadow border border-gray-200 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Máy */}
          <div>
            <label htmlFor="audit-filter-workstation" className="block text-xs font-semibold text-gray-700 mb-1">
              Máy
            </label>
            <select
              id="audit-filter-workstation"
              aria-label="Chọn máy"
              value={workstationId}
              onChange={(e) => setWorkstationId(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- Tất cả máy --</option>
              {workstations?.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.mqtt_identity} ({ws.hostname})
                </option>
              ))}
            </select>
          </div>

          {/* Zone */}
          <div>
            <label htmlFor="audit-filter-zone" className="block text-xs font-semibold text-gray-700 mb-1">
              Zone
            </label>
            <select
              id="audit-filter-zone"
              aria-label="Chọn zone"
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- Tất cả zone --</option>
              {zones?.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>

          {/* Người dùng */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Người dùng
            </label>
            {selectedUser ? (
              <div className="flex items-center space-x-2 border border-gray-300 rounded px-3 py-1.5 bg-gray-50">
                <span className="text-sm text-gray-900 flex-1 truncate">
                  {selectedUser.external_id} — {selectedUser.full_name}
                </span>
                <button
                  type="button"
                  onClick={handleClearUser}
                  className="text-xs text-red-600 hover:text-red-800 font-bold"
                  aria-label="Xóa chọn người dùng"
                >
                  ✕
                </button>
              </div>
            ) : (
              <UserPicker onPick={handleSelectUser} placeholder="Tìm người dùng..." />
            )}
          </div>

          {/* Kết quả */}
          <div>
            <label htmlFor="audit-filter-outcome" className="block text-xs font-semibold text-gray-700 mb-1">
              Kết quả
            </label>
            <select
              id="audit-filter-outcome"
              aria-label="Chọn kết quả"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Tất cả</option>
              <option value="granted">Cho vào (granted)</option>
              <option value="denied">Từ chối (denied)</option>
              <option value="noop">Đã trong phiên (noop)</option>
              <option value="error">Lỗi (error)</option>
            </select>
          </div>

          {/* Lý do */}
          <div>
            <label htmlFor="audit-filter-reason" className="block text-xs font-semibold text-gray-700 mb-1">
              Lý do
            </label>
            <select
              id="audit-filter-reason"
              aria-label="Chọn lý do"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {REASON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* UID thẻ */}
          <div>
            <label htmlFor="audit-filter-card-uid" className="block text-xs font-semibold text-gray-700 mb-1">
              UID thẻ
            </label>
            <input
              id="audit-filter-card-uid"
              type="text"
              value={cardUid}
              onChange={(e) => setCardUid(e.target.value)}
              placeholder="UID thẻ (VD: 04 A3 2B 1C)"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Time filters */}
        <div className="pt-2 border-t border-gray-100 flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center space-x-2">
            <label htmlFor="audit-filter-from" className="text-xs font-semibold text-gray-700 whitespace-nowrap">
              Từ:
            </label>
            <input
              id="audit-filter-from"
              type="datetime-local"
              value={fromTime}
              onChange={(e) => setFromTime(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center space-x-2">
            <label htmlFor="audit-filter-to" className="text-xs font-semibold text-gray-700 whitespace-nowrap">
              Đến:
            </label>
            <input
              id="audit-filter-to"
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

      {/* Note above the table */}
      <p className="text-xs text-gray-500 italic">
        Thời điểm theo đồng hồ của máy trạm.
      </p>

      {/* Error display */}
      {isError && (
        <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200 text-sm">
          {errorMessage(error)}
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="p-8 text-center text-gray-500">Đang tải nhật ký quẹt thẻ…</div>
      )}

      {/* Main Table */}
      {!isLoading && !isError && (
        <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-gray-600 font-medium">
                <tr>
                  <th className="px-4 py-3 text-left">Thời điểm</th>
                  <th className="px-4 py-3 text-left">Máy</th>
                  <th className="px-4 py-3 text-left">Người</th>
                  <th className="px-4 py-3 text-left">Kết quả</th>
                  <th className="px-4 py-3 text-left">Lý do</th>
                  <th className="px-4 py-3 text-left">Profile</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {logs.length > 0 ? (
                  logs.map((log) => {
                    const occMs = new Date(log.occurred_at).getTime();
                    const recMs = new Date(log.received_at).getTime();
                    const isLate =
                      !isNaN(occMs) && !isNaN(recMs) && Math.abs(recMs - occMs) > 5 * 60 * 1000;

                    return (
                      <tr key={log.id} className="hover:bg-gray-50">
                        {/* Thời điểm */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="text-gray-900">{formatDateTime(log.occurred_at)}</div>
                          {isLate && (
                            <div className="text-xs text-gray-400">
                              nhận lúc {formatDateTime(log.received_at)}
                            </div>
                          )}
                        </td>

                        {/* Máy */}
                        <td className="px-4 py-3 text-gray-900 font-mono text-xs whitespace-nowrap">
                          {log.workstation ? (
                            <Link
                              to={`/workstations/${log.workstation.id}`}
                              className="text-blue-600 hover:underline"
                            >
                              {log.workstation.mqtt_identity}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>

                        {/* Người */}
                        <td className="px-4 py-3 text-gray-900">
                          {log.user ? (
                            <Link
                              to={`/users/${log.user.id}`}
                              className="text-blue-600 hover:underline"
                            >
                              {log.user.external_id} — {log.user.full_name}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>

                        {/* Kết quả */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {getOutcomeBadge(log.outcome)}
                        </td>

                        {/* Lý do */}
                        <td className="px-4 py-3 text-gray-700">
                          {reasonLabel(log.reason, log.detail)}
                        </td>

                        {/* Profile */}
                        <td className="px-4 py-3 text-gray-700 font-mono text-xs">
                          {log.target_os_username || '—'}
                        </td>

                        {/* Thao tác */}
                        <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                          {log.has_card_uid && (
                            <>
                              {uids[log.id] ? (
                                <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded border border-gray-300">
                                  {uids[log.id]}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleFetchUid(log.id)}
                                  disabled={loadingUids[log.id]}
                                  className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                                >
                                  {loadingUids[log.id] ? 'Đang đọc…' : 'Xem UID'}
                                </button>
                              )}
                            </>
                          )}
                          {log.reason === 'unknown_card' && (
                            <Link
                              to="/cards"
                              className="text-xs text-blue-600 hover:underline font-medium"
                            >
                              Đăng ký thẻ này
                            </Link>
                          )}
                          {!log.has_card_uid && log.reason !== 'unknown_card' && (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      Không tìm thấy bản ghi quẹt thẻ nào
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
