import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getUser, listSessions, listWorkstations } from '../../api/endpoints';
import type { Session, SessionStatus, User, WorkstationSummary } from '../../api/types';
import { endReasonLabel, endSourceNote, sessionStatusLabel } from '../../lib/labels';
import { formatDateTime } from '../../lib/time';
import { errorMessage } from '../../lib/errors';
import { useNow } from '../../lib/useNow';
import { UserPicker } from '../../components/UserPicker';
import { getVnDateString, toVnIso } from './AuditTab';

export function SessionsTab({
  initialWorkstationId,
  initialUserId,
}: {
  initialWorkstationId?: string;
  initialUserId?: string;
}) {
  const now = useNow();

  const [workstationId, setWorkstationId] = useState(initialWorkstationId || '');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userIdFilter, setUserIdFilter] = useState(initialUserId || '');
  const [status, setStatus] = useState<SessionStatus | ''>('');
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');

  // Load workstations for dropdown
  const { data: workstations } = useQuery<WorkstationSummary[]>({
    queryKey: ['workstations'],
    queryFn: () => listWorkstations(),
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

  // Infinite query for sessions
  const filterParams = {
    workstation_id: workstationId || undefined,
    user_id: selectedUser ? selectedUser.id : userIdFilter || undefined,
    status: status || undefined,
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
    queryKey: ['sessions', filterParams],
    queryFn: ({ pageParam }) =>
      listSessions({
        ...filterParams,
        cursor: pageParam,
        limit: 50,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  const sessions: Session[] = useMemo(() => {
    return data?.pages.flatMap((page) => page.items) ?? [];
  }, [data]);

  const getStatusBadge = (st: SessionStatus) => {
    switch (st) {
      case 'active':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
            {sessionStatusLabel(st)}
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
            {sessionStatusLabel(st)}
          </span>
        );
      case 'forced_logout':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
            {sessionStatusLabel(st)}
          </span>
        );
      case 'abandoned':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
            {sessionStatusLabel(st)}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
            {st}
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters Section */}
      <div className="bg-white p-4 rounded-lg shadow border border-gray-200 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Máy */}
          <div>
            <label htmlFor="session-filter-workstation" className="block text-xs font-semibold text-gray-700 mb-1">
              Máy
            </label>
            <select
              id="session-filter-workstation"
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

          {/* Trạng thái */}
          <div>
            <label htmlFor="session-filter-status" className="block text-xs font-semibold text-gray-700 mb-1">
              Trạng thái
            </label>
            <select
              id="session-filter-status"
              aria-label="Chọn trạng thái"
              value={status}
              onChange={(e) => setStatus(e.target.value as SessionStatus | '')}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Tất cả trạng thái</option>
              <option value="active">Đang dùng (active)</option>
              <option value="completed">Đã kết thúc (completed)</option>
              <option value="forced_logout">Bị đăng xuất (forced_logout)</option>
              <option value="abandoned">Bị bỏ dở (abandoned)</option>
            </select>
          </div>
        </div>

        {/* Time filters */}
        <div className="pt-2 border-t border-gray-100 flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center space-x-2">
            <label htmlFor="session-filter-from" className="text-xs font-semibold text-gray-700 whitespace-nowrap">
              Từ:
            </label>
            <input
              id="session-filter-from"
              type="datetime-local"
              value={fromTime}
              onChange={(e) => setFromTime(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center space-x-2">
            <label htmlFor="session-filter-to" className="text-xs font-semibold text-gray-700 whitespace-nowrap">
              Đến:
            </label>
            <input
              id="session-filter-to"
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
        <div className="p-8 text-center text-gray-500">Đang tải danh sách phiên…</div>
      )}

      {/* Main Table */}
      {!isLoading && !isError && (
        <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-gray-600 font-medium">
                <tr>
                  <th className="px-4 py-3 text-left">Máy</th>
                  <th className="px-4 py-3 text-left">Người</th>
                  <th className="px-4 py-3 text-left">Profile</th>
                  <th className="px-4 py-3 text-left">Bắt đầu</th>
                  <th className="px-4 py-3 text-left">Hạn</th>
                  <th className="px-4 py-3 text-left">Kết thúc</th>
                  <th className="px-4 py-3 text-left">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {sessions.length > 0 ? (
                  sessions.map((s) => {
                    const isOverdue =
                      s.status === 'active' && new Date(s.expires_at).getTime() < now;
                    const isEnded = s.status !== 'active' || s.ended_at !== null;
                    const sourceNote = endSourceNote(s.end_source);

                    return (
                      <tr key={s.id} className="hover:bg-gray-50">
                        {/* Máy */}
                        <td className="px-4 py-3 font-mono text-xs text-gray-900 whitespace-nowrap">
                          {s.workstation ? (
                            <Link
                              to={`/workstations/${s.workstation.id}`}
                              className="text-blue-600 hover:underline"
                            >
                              {s.workstation.mqtt_identity}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>

                        {/* Người */}
                        <td className="px-4 py-3 text-gray-900">
                          {s.user ? (
                            <Link
                              to={`/users/${s.user.id}`}
                              className="text-blue-600 hover:underline"
                            >
                              {s.user.external_id} — {s.user.full_name}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>

                        {/* Profile */}
                        <td className="px-4 py-3 text-gray-700 font-mono text-xs">
                          {s.os_username || '—'}
                        </td>

                        {/* Bắt đầu */}
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          {formatDateTime(s.started_at)}
                        </td>

                        {/* Hạn */}
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          {formatDateTime(s.expires_at)}
                        </td>

                        {/* Kết thúc */}
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          {s.ended_at ? formatDateTime(s.ended_at) : '—'}
                        </td>

                        {/* Trạng thái */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {getStatusBadge(s.status)}
                          {isOverdue && (
                            <div className="text-xs text-red-600 font-medium mt-0.5">
                              quá hạn chưa kết thúc
                            </div>
                          )}
                          {isEnded && s.end_reason && (
                            <div className="text-xs text-gray-500 mt-0.5">
                              {endReasonLabel(s.end_reason)}
                              {sourceNote ? ` ${sourceNote}` : ''}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      Không tìm thấy phiên nào
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
