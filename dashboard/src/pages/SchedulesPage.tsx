import React, { useRef, useState } from 'react';
import {
  Button,
  ConfirmDialog,
  EmptyRow,
  Field,
  fieldDescribedBy,
  selectClass,
  Notice,
  PageHeader,
  StatusPill,
  Table,
  THead,
  TH,
  TR,
  TD,
} from '../components/ui';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteSchedule,
  disableSchedule,
  enableSchedule,
  listGroups,
  listSchedules,
  listWorkstations,
  listZones,
} from '../api/endpoints';
import type { Schedule, ScheduleStatus, User } from '../api/types';
import { formatDays, formatValidity } from '../lib/schedule';
import { errorMessage } from '../lib/errors';
import { UserPicker } from '../components/UserPicker';

export function SchedulesPage() {
  const queryClient = useQueryClient();

  const [viewBy, setViewBy] = useState<'all' | 'zone' | 'workstation' | 'group' | 'user'>('all');
  const [selectedZoneId, setSelectedZoneId] = useState<string>('');
  const [selectedWorkstationId, setSelectedWorkstationId] = useState<string>('');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [statusFilter, setStatusFilter] = useState<ScheduleStatus | ''>('');

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const [scheduleToDelete, setScheduleToDelete] = useState<Schedule | null>(null);

  // Load auxiliary data for filters
  const { data: zones } = useQuery({
    queryKey: ['zones'],
    queryFn: listZones,
    enabled: viewBy === 'zone',
  });

  const { data: workstations } = useQuery({
    queryKey: ['workstations'],
    queryFn: () => listWorkstations(),
    enabled: viewBy === 'workstation',
  });

  const { data: groups } = useQuery({
    queryKey: ['groups'],
    queryFn: listGroups,
    enabled: viewBy === 'group',
  });

  // Query schedules with active filters
  const filterParams: {
    workstation_id?: string;
    zone_id?: string;
    group_id?: string;
    user_id?: string;
    status?: ScheduleStatus;
  } = {};

  if (viewBy === 'zone' && selectedZoneId) {
    filterParams.zone_id = selectedZoneId;
  } else if (viewBy === 'workstation' && selectedWorkstationId) {
    filterParams.workstation_id = selectedWorkstationId;
  } else if (viewBy === 'group' && selectedGroupId) {
    filterParams.group_id = selectedGroupId;
  } else if (viewBy === 'user' && selectedUser) {
    filterParams.user_id = selectedUser.id;
  }

  if (statusFilter) {
    filterParams.status = statusFilter;
  }

  const {
    data: schedules,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['schedules', filterParams],
    queryFn: () => listSchedules(filterParams),
  });

  const handleToggleStatus = async (schedule: Schedule) => {
    if (inFlightRef.current || actionLoadingId) return;
    inFlightRef.current = true;
    setActionLoadingId(schedule.id);
    setPageError(null);
    try {
      if (schedule.status === 'enabled') {
        await disableSchedule(schedule.id);
      } else {
        await enableSchedule(schedule.id);
      }
      await queryClient.invalidateQueries({ queryKey: ['schedules'] });
    } catch (err) {
      setPageError(errorMessage(err));
    } finally {
      setActionLoadingId(null);
      inFlightRef.current = false;
    }
  };

  const handleDelete = async (schedule: Schedule) => {
    if (inFlightRef.current || actionLoadingId) return;
    inFlightRef.current = true;
    setActionLoadingId(schedule.id);
    setPageError(null);
    try {
      await deleteSchedule(schedule.id);
      await queryClient.invalidateQueries({ queryKey: ['schedules'] });
      setScheduleToDelete(null);
    } finally {
      setActionLoadingId(null);
      inFlightRef.current = false;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <PageHeader
        title="Lịch"
        description="Quản lý quyền và thời gian đăng nhập vào máy trạm"
        actions={<Link to="/schedules/new" className="inline-flex items-center justify-center h-8 px-3 rounded bg-accent text-white hover:bg-accent-hover text-sm font-medium">Thêm lịch</Link>}
      />

      {
        pageError && (
          <Notice tone="danger">{pageError}</Notice>
        )
      }

      {/* Info Box (always visible) */}
      <Notice tone="info">
        <p>
          Một người được vào máy khi khớp ít nhất một lịch đang bật (ai + ở đâu + khi nào). Các
          lịch cộng quyền với nhau, không lịch nào chặn lịch nào.
        </p>
        <p>
          Các khung giờ liền nhau trong ngày được nối thành một phiên. Không hỗ trợ ca qua nửa đêm.
        </p>
        <p>
          Sửa lịch không cắt phiên đang chạy. Muốn kéo dài phiên, người dùng quẹt thẻ lại sau khi
          máy nhận lịch mới.
        </p>
        <p>
          Thay đổi có hiệu lực tại máy sau khi máy nhận dữ liệu mới (xem cột Đồng bộ ở trang Máy
          trạm).
        </p>
      </Notice>

      {/* Filter Section */}
      <div className="bg-surface p-4 rounded border border-line space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
          {/* Xem theo */}
          <Field htmlFor="filter-view-by" label="Xem theo">
            <select
              id="filter-view-by"
              value={viewBy}
              onChange={(e) => {
                const val = e.target.value as typeof viewBy;
                setViewBy(val);
                setSelectedZoneId('');
                setSelectedWorkstationId('');
                setSelectedGroupId('');
                setSelectedUser(null);
              }}
              className={`w-full ${selectClass}`}
            >
              <option value="all">Tất cả</option>
              <option value="zone">Zone</option>
              <option value="workstation">Máy</option>
              <option value="group">Nhóm</option>
              <option value="user">Người dùng</option>
            </select>
          </Field>

          {/* Matching picker */}
          <div>
            {viewBy === 'zone' && (
              <Field htmlFor="filter-zone" label="Chọn Zone">
                <select
                  id="filter-zone"
                  aria-label="Chọn zone"
                  value={selectedZoneId}
                  onChange={(e) => setSelectedZoneId(e.target.value)}
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
            )}

            {viewBy === 'workstation' && (
              <Field htmlFor="filter-workstation" label="Chọn Máy" hint="Gồm cả lịch gán cho zone của máy.">
                <select
                  id="filter-workstation"
                  aria-describedby={fieldDescribedBy('filter-workstation', { hint: true })}
                  aria-label="Chọn máy"
                  value={selectedWorkstationId}
                  onChange={(e) => setSelectedWorkstationId(e.target.value)}
                  className={`w-full ${selectClass}`}
                >
                  <option value="">-- Chọn máy --</option>
                  {workstations?.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.mqtt_identity} ({ws.hostname})
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {viewBy === 'group' && (
              <Field htmlFor="filter-group" label="Chọn Nhóm">
                <select
                  id="filter-group"
                  aria-label="Chọn nhóm"
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value)}
                  className={`w-full ${selectClass}`}
                >
                  <option value="">-- Chọn nhóm --</option>
                  {groups?.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {viewBy === 'user' && (
              <Field
                htmlFor="filter-user"
                label="Chọn Người dùng"
                hint="Gồm cả lịch của các nhóm người này thuộc."
              >
                <div
                  id="filter-user"
                  role="group"
                  aria-label="Chọn Người dùng"
                  aria-describedby={fieldDescribedBy('filter-user', { hint: true })}
                >
                  {selectedUser ? (
                    <div className="flex items-center space-x-2 border border-control rounded px-3 py-1.5 bg-canvas">
                      <span className="text-sm text-ink flex-1 truncate">
                        {selectedUser.external_id} — {selectedUser.full_name}
                      </span>
                      <Button
                        variant="quiet"
                        type="button"
                        onClick={() => setSelectedUser(null)}
                      >
                        Đổi
                      </Button>
                    </div>
                  ) : (
                    <UserPicker onPick={setSelectedUser} placeholder="Tìm người dùng..." />
                  )}
                </div>
              </Field>
            )}
          </div>

          {/* Status filter */}
          <Field htmlFor="filter-status" label="Trạng thái">
            <select
              id="filter-status"
              aria-label="Lọc trạng thái"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ScheduleStatus | '')}
              className={`w-full ${selectClass}`}
            >
              <option value="">Tất cả</option>
              <option value="enabled">Đang bật</option>
              <option value="disabled">Đã tắt</option>
            </select>
          </Field>
        </div>
      </div>

      {/* Main Table */}
      {
        isLoading && (
          <Notice tone="info">Đang tải…</Notice>
        )
      }

      {
        isError && (
          <Notice tone="danger">{errorMessage(error)}</Notice>
        )
      }

      {
        !isLoading && !isError && (
          <>
            <Table>
              <THead>
                <TR>
                  <TH className="text-left">Tên</TH>
                  <TH className="text-left">Ai</TH>
                  <TH className="text-left">Ở đâu</TH>
                  <TH className="text-left">Ngày</TH>
                  <TH className="text-left">Giờ</TH>
                  <TH className="text-left">Hiệu lực</TH>
                  <TH className="text-left">Profile</TH>
                  <TH className="text-left">Trạng thái</TH>
                  <TH className="text-right">Thao tác</TH>
                </TR>
              </THead>
              <tbody>
                {schedules && schedules.length > 0 ? (
                  schedules.map((schedule) => {
                    const isSubjectGroup = schedule.subject.type === 'group';
                    const whoText = isSubjectGroup
                      ? `Nhóm: ${schedule.subject.name}`
                      : `Người: ${schedule.subject.external_id ? `${schedule.subject.external_id} — ` : ''}${schedule.subject.name}`;

                    const isTargetZone = schedule.target.type === 'zone';
                    const whereText = isTargetZone
                      ? `Zone: ${schedule.target.name}`
                      : `Máy: ${schedule.target.name}`;

                    const actionBusy = actionLoadingId === schedule.id;

                    return (
                      <TR key={schedule.id} className="hover:bg-canvas">
                        <TD className="font-medium text-ink">{schedule.name}</TD>
                        <TD className="text-ink">{whoText}</TD>
                        <TD className={isTargetZone ? '' : 'font-mono'}>{whereText}</TD>
                        <TD className="text-ink">{formatDays(schedule.days_of_week)}</TD>
                        <TD className="text-ink whitespace-nowrap">
                          {schedule.start_time}–{schedule.end_time}
                        </TD>
                        <TD className="text-ink whitespace-nowrap">
                          {formatValidity(schedule.valid_from, schedule.valid_to)}
                        </TD>
                        <TD className="text-ink">
                          {schedule.target_os_username || 'mặc định của máy'}
                        </TD>
                        <TD>
                          {schedule.status === 'enabled' ? (
                            <StatusPill tone="ok">Đang bật</StatusPill>
                          ) : (
                            <StatusPill tone="neutral">Đã tắt</StatusPill>
                          )}
                        </TD>
                        <TD className="text-right space-x-2 whitespace-nowrap">
                          <Link
                            to={`/schedules/${schedule.id}/edit`}
                            className="inline-flex items-center justify-center h-7 px-2.5 rounded text-xs font-medium text-accent hover:bg-accent-tint"
                          >
                            Sửa
                          </Link>
                          <Button
                            variant="quiet"
                            type="button"
                            disabled={actionBusy}
                            onClick={() => handleToggleStatus(schedule)}
                          >
                            {schedule.status === 'enabled' ? 'Tắt' : 'Bật'}
                          </Button>
                          <Button
                            variant="quiet"
                            type="button"
                            disabled={actionBusy}
                            onClick={() => setScheduleToDelete(schedule)}
                          >
                            {actionBusy ? 'Đang xóa…' : 'Xóa'}
                          </Button>
                        </TD>
                      </TR>
                    );
                  })
                ) : (
                  <EmptyRow colSpan={9}>
                    Chưa có lịch nào
                  </EmptyRow>
                )}
              </tbody>
            </Table>
          </>
        )
      }
      <ConfirmDialog
        open={scheduleToDelete !== null}
        title={`Xóa lịch ${scheduleToDelete?.name ?? ''}?`}
        message={`Xóa lịch ${scheduleToDelete?.name ?? ''}? Người dùng sẽ không vào được theo lịch này sau khi máy nhận dữ liệu mới.`}
        confirmLabel="Xóa"
        tone="danger"
        onCancel={() => setScheduleToDelete(null)}
        onConfirm={async () => { if (scheduleToDelete) await handleDelete(scheduleToDelete); }}
      />
    </div >
  );
}
