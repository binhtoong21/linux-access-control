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
          <StatusPill tone="ok">
            {outcomeLabel(out)}
          </StatusPill>
        );
      case 'denied':
        return (
          <StatusPill tone="danger">
            {outcomeLabel(out)}
          </StatusPill>
        );
      case 'noop':
        return (
          <StatusPill tone="info">
            {outcomeLabel(out)}
          </StatusPill>
        );
      case 'error':
        return <StatusPill tone="danger">{outcomeLabel(out)}</StatusPill>;
      default:
        return (
          <StatusPill tone="neutral">
            {outcomeLabel(out)}
          </StatusPill>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters Section */}
      <div className="bg-surface p-4 rounded border border-line space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Máy */}
          <Field label="Máy" htmlFor="audit-filter-workstation">
            <select
              id="audit-filter-workstation"
              aria-describedby={fieldDescribedBy('audit-filter-workstation', {})}
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

          {/* Zone */}
          <Field label="Zone" htmlFor="audit-filter-zone">
            <select
              id="audit-filter-zone"
              aria-describedby={fieldDescribedBy('audit-filter-zone', {})}
              aria-label="Chọn zone"
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              className={`w-full ${selectClass}`}
            >
              <option value="">-- Tất cả zone --</option>
              {zones?.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </Field>

          {/* Người dùng */}
          <Field label="Người dùng" htmlFor="audit-filter-user">
            <div id="audit-filter-user">
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

          {/* Kết quả */}
          <Field label="Kết quả" htmlFor="audit-filter-outcome">
            <select
              id="audit-filter-outcome"
              aria-describedby={fieldDescribedBy('audit-filter-outcome', {})}
              aria-label="Chọn kết quả"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className={`w-full ${selectClass}`}
            >
              <option value="">Tất cả</option>
              <option value="granted">Cho vào (granted)</option>
              <option value="denied">Từ chối (denied)</option>
              <option value="noop">Đã trong phiên (noop)</option>
              <option value="error">Lỗi (error)</option>
            </select>
          </Field>

          {/* Lý do */}
          <Field label="Lý do" htmlFor="audit-filter-reason">
            <select
              id="audit-filter-reason"
              aria-describedby={fieldDescribedBy('audit-filter-reason', {})}
              aria-label="Chọn lý do"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={`w-full ${selectClass}`}
            >
              {REASON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>

          {/* UID thẻ */}
          <Field label="UID thẻ" htmlFor="audit-filter-card-uid">
            <input
              id="audit-filter-card-uid"
              aria-describedby={fieldDescribedBy('audit-filter-card-uid', {})}
              type="text"
              value={cardUid}
              onChange={(e) => setCardUid(e.target.value)}
              placeholder="UID thẻ (VD: 04 A3 2B 1C)"
              className={`w-full ${inputClass} uppercase font-mono`}
            />
          </Field>
        </div>

        {/* Time filters */}
        <div className="pt-2 border-t border-line flex flex-wrap items-center gap-3 text-sm">
          <Field label="Từ:" htmlFor="audit-filter-from">
            <input
              id="audit-filter-from"
              aria-describedby={fieldDescribedBy('audit-filter-from', {})}
              type="datetime-local"
              value={fromTime}
              onChange={(e) => setFromTime(e.target.value)}
              className={`w-full ${inputClass}`}
            />
          </Field>
          <Field label="Đến:" htmlFor="audit-filter-to">
            <input
              id="audit-filter-to"
              aria-describedby={fieldDescribedBy('audit-filter-to', {})}
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

      {/* Note above the table */}
      <p className="text-xs text-ink-muted italic">
        Thời điểm theo đồng hồ của máy trạm.
      </p>

      {/* Error display */}
      {isError && (
        <Notice tone="danger">
          {errorMessage(error)}
        </Notice>
      )}

      {/* Loading state */}
      {isLoading && (
        <Notice tone="info">Đang tải nhật ký quẹt thẻ…</Notice>
      )}

      {/* Main Table */}
      {!isLoading && !isError && (
        <div className="space-y-4">
          <Table>
            <THead>
              <TR>
                <TH className="text-left">Thời điểm</TH>
                <TH className="text-left">Máy</TH>
                <TH className="text-left">Người</TH>
                <TH className="text-left">Kết quả</TH>
                <TH className="text-left">Lý do</TH>
                <TH className="text-left">Profile</TH>
                <TH className="text-right">Thao tác</TH>
              </TR>
            </THead>
            <tbody>
              {logs.length > 0 ? (
                logs.map((log) => {
                  const occMs = new Date(log.occurred_at).getTime();
                  const recMs = new Date(log.received_at).getTime();
                  const isLate =
                    !isNaN(occMs) && !isNaN(recMs) && Math.abs(recMs - occMs) > 5 * 60 * 1000;

                  return (
                    <TR key={log.id} interactive>
                      {/* Thời điểm */}
                      <TD className="whitespace-nowrap">
                        <div className="text-ink">{formatDateTime(log.occurred_at)}</div>
                        {isLate && (
                          <div className="text-xs text-ink-muted">
                            nhận lúc {formatDateTime(log.received_at)}
                          </div>
                        )}
                      </TD>

                      {/* Máy */}
                      <TD className="text-ink font-mono text-xs whitespace-nowrap">
                        {log.workstation ? (
                          <Link
                            to={`/workstations/${log.workstation.id}`}
                            className="text-accent hover:underline"
                          >
                            {log.workstation.mqtt_identity}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TD>

                      {/* Người */}
                      <TD className="text-ink">
                        {log.user ? (
                          <Link
                            to={`/users/${log.user.id}`}
                            className="text-accent hover:underline"
                          >
                            {log.user.external_id} — {log.user.full_name}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TD>

                      {/* Kết quả */}
                      <TD className="whitespace-nowrap">
                        {getOutcomeBadge(log.outcome)}
                      </TD>

                      {/* Lý do */}
                      <TD className="text-ink">
                        {reasonLabel(log.reason, log.detail)}
                      </TD>

                      {/* Profile */}
                      <TD className="text-ink font-mono text-xs">
                        {log.target_os_username || '—'}
                      </TD>

                      {/* Thao tác */}
                      <TD className="text-right space-x-2 whitespace-nowrap">
                        {log.has_card_uid && (
                          <>
                            {uids[log.id] ? (
                              <span className="font-mono text-xs bg-canvas px-2 py-1 rounded border border-control">
                                {uids[log.id].replace(/\s/g, '').toUpperCase().match(/.{1,2}/g)?.join(' ')}
                              </span>
                            ) : (
                              <Button
                                variant="quiet"
                                size="sm"
                                type="button"
                                onClick={() => handleFetchUid(log.id)}
                                disabled={loadingUids[log.id]}
                              >
                                {loadingUids[log.id] ? 'Đang đọc…' : 'Xem UID'}
                              </Button>
                            )}
                          </>
                        )}
                        {log.reason === 'unknown_card' && (
                          <Link
                            to="/cards"
                            className="text-xs text-accent hover:underline font-medium"
                          >
                            Đăng ký thẻ này
                          </Link>
                        )}
                        {!log.has_card_uid && log.reason !== 'unknown_card' && (
                          <span className="text-ink-muted">—</span>
                        )}
                      </TD>
                    </TR>
                  );
                })
              ) : (
                <EmptyRow colSpan={7}>Không tìm thấy bản ghi quẹt thẻ nào</EmptyRow>
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
