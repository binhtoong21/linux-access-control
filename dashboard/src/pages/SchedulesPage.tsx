import React, { useRef, useState } from 'react';
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
    const confirmed = window.confirm(
      `Xóa lịch ${schedule.name}? Người dùng sẽ không vào được theo lịch này sau khi máy nhận dữ liệu mới.`,
    );
    if (!confirmed) return;

    inFlightRef.current = true;
    setActionLoadingId(schedule.id);
    setPageError(null);
    try {
      await deleteSchedule(schedule.id);
      await queryClient.invalidateQueries({ queryKey: ['schedules'] });
    } catch (err) {
      setPageError(errorMessage(err));
    } finally {
      setActionLoadingId(null);
      inFlightRef.current = false;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Lịch</h1>
          <p className="text-sm text-gray-500">
            Quản lý quyền và thời gian đăng nhập vào máy trạm
          </p>
        </div>
        <div>
          <Link
            to="/schedules/new"
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 shadow-sm"
          >
            Thêm lịch
          </Link>
        </div>
      </div>

      {pageError && (
        <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200 text-sm">
          {pageError}
        </div>
      )}

      {/* Info Box (always visible) */}
      <div className="bg-blue-50 border border-blue-200 text-blue-900 rounded-lg p-4 text-xs sm:text-sm space-y-1">
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
      </div>

      {/* Filter Section */}
      <div className="bg-white p-4 rounded-lg shadow border border-gray-200 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
          {/* Xem theo */}
          <div>
            <label htmlFor="filter-view-by" className="block text-xs font-semibold text-gray-700 mb-1">
              Xem theo
            </label>
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
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Tất cả</option>
              <option value="zone">Zone</option>
              <option value="workstation">Máy</option>
              <option value="group">Nhóm</option>
              <option value="user">Người dùng</option>
            </select>
          </div>

          {/* Matching picker */}
          <div>
            {viewBy === 'zone' && (
              <div>
                <label htmlFor="filter-zone" className="block text-xs font-semibold text-gray-700 mb-1">
                  Chọn Zone
                </label>
                <select
                  id="filter-zone"
                  aria-label="Chọn zone"
                  value={selectedZoneId}
                  onChange={(e) => setSelectedZoneId(e.target.value)}
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
            )}

            {viewBy === 'workstation' && (
              <div>
                <label htmlFor="filter-workstation" className="block text-xs font-semibold text-gray-700 mb-1">
                  Chọn Máy
                </label>
                <select
                  id="filter-workstation"
                  aria-label="Chọn máy"
                  value={selectedWorkstationId}
                  onChange={(e) => setSelectedWorkstationId(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Chọn máy --</option>
                  {workstations?.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.mqtt_identity} ({ws.hostname})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Gồm cả lịch gán cho zone của máy.
                </p>
              </div>
            )}

            {viewBy === 'group' && (
              <div>
                <label htmlFor="filter-group" className="block text-xs font-semibold text-gray-700 mb-1">
                  Chọn Nhóm
                </label>
                <select
                  id="filter-group"
                  aria-label="Chọn nhóm"
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Chọn nhóm --</option>
                  {groups?.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {viewBy === 'user' && (
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Chọn Người dùng
                </label>
                {selectedUser ? (
                  <div className="flex items-center space-x-2 border border-gray-300 rounded px-3 py-1.5 bg-gray-50">
                    <span className="text-sm text-gray-900 flex-1 truncate">
                      {selectedUser.external_id} — {selectedUser.full_name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedUser(null)}
                      className="text-xs text-blue-600 hover:underline font-medium"
                    >
                      Đổi
                    </button>
                  </div>
                ) : (
                  <UserPicker onPick={setSelectedUser} placeholder="Tìm người dùng..." />
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Gồm cả lịch của các nhóm người này thuộc.
                </p>
              </div>
            )}
          </div>

          {/* Status filter */}
          <div>
            <label htmlFor="filter-status" className="block text-xs font-semibold text-gray-700 mb-1">
              Trạng thái
            </label>
            <select
              id="filter-status"
              aria-label="Lọc trạng thái"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ScheduleStatus | '')}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Tất cả</option>
              <option value="enabled">Đang bật</option>
              <option value="disabled">Đã tắt</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Table */}
      {isLoading && (
        <div className="p-8 text-center text-gray-500">Đang tải…</div>
      )}

      {isError && (
        <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200">
          {errorMessage(error)}
        </div>
      )}

      {!isLoading && !isError && (
        <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-gray-600 font-medium">
                <tr>
                  <th className="px-4 py-3 text-left">Tên</th>
                  <th className="px-4 py-3 text-left">Ai</th>
                  <th className="px-4 py-3 text-left">Ở đâu</th>
                  <th className="px-4 py-3 text-left">Ngày</th>
                  <th className="px-4 py-3 text-left">Giờ</th>
                  <th className="px-4 py-3 text-left">Hiệu lực</th>
                  <th className="px-4 py-3 text-left">Profile</th>
                  <th className="px-4 py-3 text-left">Trạng thái</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
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
                      <tr key={schedule.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{schedule.name}</td>
                        <td className="px-4 py-3 text-gray-700">{whoText}</td>
                        <td className="px-4 py-3 text-gray-700">{whereText}</td>
                        <td className="px-4 py-3 text-gray-700">{formatDays(schedule.days_of_week)}</td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          {schedule.start_time}–{schedule.end_time}
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          {formatValidity(schedule.valid_from, schedule.valid_to)}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {schedule.target_os_username || 'mặc định của máy'}
                        </td>
                        <td className="px-4 py-3">
                          {schedule.status === 'enabled' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                              Đang bật
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                              Đã tắt
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                          <Link
                            to={`/schedules/${schedule.id}/edit`}
                            className="text-xs px-2.5 py-1 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 inline-block"
                          >
                            Sửa
                          </Link>
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => handleToggleStatus(schedule)}
                            className="text-xs px-2.5 py-1 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
                          >
                            {schedule.status === 'enabled' ? 'Tắt' : 'Bật'}
                          </button>
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => handleDelete(schedule)}
                            className="text-xs px-2.5 py-1 border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
                          >
                            {actionBusy ? 'Đang xóa…' : 'Xóa'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                      Chưa có lịch nào
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
