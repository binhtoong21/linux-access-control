import React, { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { listAdminActions } from '../../api/endpoints';
import type { AdminAction } from '../../api/types';
import { formatDateTime } from '../../lib/time';
import { errorMessage } from '../../lib/errors';
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
      <div className="bg-surface p-4 rounded border border-line space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Loại đối tượng */}
          <Field label="Loại đối tượng" htmlFor="admin-filter-entity-type">
            <select
              id="admin-filter-entity-type"
              aria-describedby={fieldDescribedBy('admin-filter-entity-type', {})}
              aria-label="Chọn loại đối tượng"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className={`w-full ${selectClass}`}
            >
              {ENTITY_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* Time filters */}
        <div className="pt-2 border-t border-line flex flex-wrap items-center gap-3 text-sm">
          <Field label="Từ:" htmlFor="admin-filter-from">
            <input
              id="admin-filter-from"
              aria-describedby={fieldDescribedBy('admin-filter-from', {})}
              type="datetime-local"
              value={fromTime}
              onChange={(e) => setFromTime(e.target.value)}
              className={`w-full ${inputClass}`}
            />
          </Field>
          <Field label="Đến:" htmlFor="admin-filter-to">
            <input
              id="admin-filter-to"
              aria-describedby={fieldDescribedBy('admin-filter-to', {})}
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
        <Notice tone="info">Đang tải thao tác quản trị…</Notice>
      )}

      {/* Main Table */}
      {!isLoading && !isError && (
        <div className="space-y-4">
          <Table>
            <THead>
              <TR>
                <TH className="text-left">Lúc</TH>
                <TH className="text-left">Admin</TH>
                <TH className="text-left">Hành động</TH>
                <TH className="text-left">Đối tượng</TH>
                <TH className="text-right">Chi tiết</TH>
              </TR>
            </THead>
            <tbody>
              {actions.length > 0 ? (
                actions.map((act) => {
                  const isExpanded = !!expandedIds[act.id];
                  const entityLabel = `${act.entity_type}${act.entity_id ? ` ${act.entity_id.slice(0, 8)}` : ''
                    }`;

                  return (
                    <React.Fragment key={act.id}>
                      <TR interactive>
                        {/* Lúc */}
                        <TD className="text-ink whitespace-nowrap">
                          {formatDateTime(act.occurred_at)}
                        </TD>

                        {/* Admin */}
                        <TD className="text-ink font-medium whitespace-nowrap">
                          {act.admin?.display_name || act.admin?.username || '—'}
                        </TD>

                        {/* Hành động */}
                        <TD>
                          <StatusPill tone="neutral">
                            {act.action}
                          </StatusPill>
                        </TD>

                        {/* Đối tượng */}
                        <TD className="text-ink font-mono text-xs whitespace-nowrap">
                          {entityLabel}
                        </TD>

                        {/* Chi tiết button */}
                        <TD className="text-right whitespace-nowrap">
                          <Button
                            variant="quiet"
                            size="sm"
                            type="button"
                            onClick={() => toggleDetails(act.id)}
                          >
                            {isExpanded ? 'Ẩn chi tiết' : 'Chi tiết'}
                          </Button>
                        </TD>
                      </TR>

                      {isExpanded && (
                        <TR key={`${act.id}-expanded`}>
                          <TD colSpan={5} className="bg-canvas px-6 py-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                              <div>
                                <span className="font-sans font-semibold text-ink block mb-1">
                                  Trước (before):
                                </span>
                                <pre className="bg-surface p-3 rounded border border-line overflow-x-auto max-h-60 whitespace-pre-wrap break-words">
                                  {act.before !== undefined && act.before !== null
                                    ? JSON.stringify(act.before, null, 2)
                                    : 'null'}
                                </pre>
                              </div>
                              <div>
                                <span className="font-sans font-semibold text-ink block mb-1">
                                  Sau (after):
                                </span>
                                <pre className="bg-surface p-3 rounded border border-line overflow-x-auto max-h-60 whitespace-pre-wrap break-words">
                                  {act.after !== undefined && act.after !== null
                                    ? JSON.stringify(act.after, null, 2)
                                    : 'null'}
                                </pre>
                              </div>
                            </div>
                          </TD>
                        </TR>
                      )}
                    </React.Fragment>
                  );
                })
              ) : (
                <EmptyRow colSpan={5}>Không tìm thấy thao tác quản trị nào</EmptyRow>
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
