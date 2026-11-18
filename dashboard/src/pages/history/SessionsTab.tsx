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
import {
  Button,
  EmptyRow,
  Field,
  fieldDescribedBy,
  inputClass,
  Notice,
  selectClass,
  StatusPill,
  Table,
  TD,
  TH,
  THead,
  TR,
} from '../../components/ui';

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
    setToTime(`${getVnDateString(new Date(Date.now() + 24 * 60 * 60 * 1000))}T00:00`); // `to` is exclusive: 00:00 of the next day
  };

  const handleSevenDays = () => {
    const sevenDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000) /* 7 calendar days including today */;
    const fromDate = getVnDateString(sevenDaysAgo);
    const today = getVnDateString();
    setFromTime(`${fromDate}T00:00`);
    setToTime(`${getVnDateString(new Date(Date.now() + 24 * 60 * 60 * 1000))}T00:00`); // `to` is exclusive: 00:00 of the next day
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
          <StatusPill tone="ok">
            {sessionStatusLabel(st)}
          </StatusPill>
        );
      case 'completed':
        return (
          <StatusPill tone="neutral">
            {sessionStatusLabel(st)}
          </StatusPill>
        );
      case 'forced_logout':
        return (
          <StatusPill tone="danger">
            {sessionStatusLabel(st)}
          </StatusPill>
        );
      case 'abandoned':
        return (
          <StatusPill tone="warn">
            {sessionStatusLabel(st)}
          </StatusPill>
        );
      default:
        return (
          <StatusPill tone="neutral">
            {st}
          </StatusPill>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters Section */}
      <div className="bg-surface p-4 rounded border border-line space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Máy */}
          <Field label="Máy" htmlFor="session-filter-workstation">
            <select
              id="session-filter-workstation"
              aria-describedby={fieldDescribedBy('session-filter-workstation', {})}
              aria-label="Chọn máy"
              value={workstationId}
              onChange={(e) => setWorkstationId(e.target.value)}
              className={`w-full ${selectClass}`}
            >
              <option value="">-- Tất cả máy --</option>
              {workstations?.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.mqtt_identity} ({ws.hostname})
                </option>
              ))}
            </select>
          </Field>

          {/* Người dùng */}
          <Field label="Người dùng" htmlFor="session-filter-user">
            <div id="session-filter-user">
              {selectedUser ? (
                <div className="flex items-center space-x-2 border border-control rounded px-3 py-1.5 bg-canvas">
                  <span className="text-sm text-ink flex-1 truncate">
                    {selectedUser.external_id} — {selectedUser.full_name}
                  </span>
                  <Button
                    variant="quiet"
                    size="sm"
                    type="button"
                    onClick={handleClearUser}
                    aria-label="Xóa chọn người dùng"
                  >
                    ✕
                  </Button>
                </div>
              ) : (
                <UserPicker onPick={handleSelectUser} placeholder="Tìm người dùng..." />
              )}
            </div>
          </Field>

          {/* Trạng thái */}
          <Field label="Trạng thái" htmlFor="session-filter-status">
            <select
              id="session-filter-status"
              aria-describedby={fieldDescribedBy('session-filter-status', {})}
              aria-label="Chọn trạng thái"
              value={status}
              onChange={(e) => setStatus(e.target.value as SessionStatus | '')}
              className={`w-full ${selectClass}`}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="active">Đang dùng (active)</option>
              <option value="completed">Đã kết thúc (completed)</option>
              <option value="forced_logout">Bị đăng xuất (forced_logout)</option>
              <option value="abandoned">Bị bỏ dở (abandoned)</option>
            </select>
          </Field>
        </div>

        {/* Time filters */}
        <div className="pt-2 border-t border-line flex flex-wrap items-center gap-3 text-sm">
          <Field label="Từ:" htmlFor="session-filter-from">
            <input
              id="session-filter-from"
              aria-describedby={fieldDescribedBy('session-filter-from', {})}
              type="datetime-local"
              value={fromTime}
              onChange={(e) => setFromTime(e.target.value)}
              className={`w-full ${inputClass}`}
            />
          </Field>
          <Field label="Đến:" htmlFor="session-filter-to">
            <input
              id="session-filter-to"
              aria-describedby={fieldDescribedBy('session-filter-to', {})}
              type="datetime-local"
              value={toTime}
              onChange={(e) => setToTime(e.target.value)}
              className={`w-full ${inputClass}`}
            />
          </Field>
          <div className="flex items-center space-x-2">
            <Button
              type="button"
              onClick={handleToday}
            >
              Hôm nay
            </Button>
            <Button
              type="button"
              onClick={handleSevenDays}
            >
              7 ngày
            </Button>
            {(fromTime || toTime) && (
              <Button
                variant="quiet"
                size="sm"
                type="button"
                onClick={handleClearTime}
              >
                Xóa giờ
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Error display */}
      {isError && (
        <Notice tone="danger">
          {errorMessage(error)}
        </Notice>
      )}

      {/* Loading state */}
      {isLoading && (
        <Notice tone="info">Đang tải danh sách phiên…</Notice>
      )}

      {/* Main Table */}
      {!isLoading && !isError && (
        <div className="space-y-4">
          <Table>
            <THead>
              <TR>
                <TH className="text-left">Máy</TH>
                <TH className="text-left">Người</TH>
                <TH className="text-left">Profile</TH>
                <TH className="text-left">Bắt đầu</TH>
                <TH className="text-left">Hạn</TH>
                <TH className="text-left">Kết thúc</TH>
                <TH className="text-left">Trạng thái</TH>
              </TR>
            </THead>
            <tbody>
              {sessions.length > 0 ? (
                sessions.map((s) => {
                  const isOverdue =
                    s.status === 'active' && new Date(s.expires_at).getTime() < now;
                  const isEnded = s.status !== 'active' || s.ended_at !== null;
                  const sourceNote = endSourceNote(s.end_source);

                  return (
                    <TR key={s.id} interactive>
                      {/* Máy */}
                      <TD className="font-mono text-xs text-ink whitespace-nowrap">
                        {s.workstation ? (
                          <Link
                            to={`/workstations/${s.workstation.id}`}
                            className="text-accent hover:underline"
                          >
                            {s.workstation.mqtt_identity}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TD>

                      {/* Người */}
                      <TD className="text-ink">
                        {s.user ? (
                          <Link
                            to={`/users/${s.user.id}`}
                            className="text-accent hover:underline"
                          >
                            {s.user.external_id} — {s.user.full_name}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TD>

                      {/* Profile */}
                      <TD className="text-ink font-mono text-xs">
                        {s.os_username || '—'}
                      </TD>

                      {/* Bắt đầu */}
                      <TD className="text-ink whitespace-nowrap">
                        {formatDateTime(s.started_at)}
                      </TD>

                      {/* Hạn */}
                      <TD className="text-ink whitespace-nowrap">
                        {formatDateTime(s.expires_at)}
                      </TD>

                      {/* Kết thúc */}
                      <TD className="text-ink whitespace-nowrap">
                        {s.ended_at ? formatDateTime(s.ended_at) : '—'}
                      </TD>

                      {/* Trạng thái */}
                      <TD className="whitespace-nowrap">
                        {getStatusBadge(s.status)}
                        {isOverdue && (
                          <div className="mt-0.5">
                            <StatusPill tone="danger">quá hạn chưa kết thúc</StatusPill>
                          </div>
                        )}
                        {isEnded && s.end_reason && (
                          <div className="text-xs text-ink-muted mt-0.5">
                            {endReasonLabel(s.end_reason)}
                            {sourceNote ? ` ${sourceNote}` : ''}
                          </div>
                        )}
                      </TD>
                    </TR>
                  );
                })
              ) : (
                <EmptyRow colSpan={7}>Không tìm thấy phiên nào</EmptyRow>
              )}
            </tbody>
          </Table>

          {/* Tải thêm button */}
          {hasNextPage && (
            <div className="p-4 text-center border-t border-line">
              <Button
                type="button"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
