import React, { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  disableWorkstation,
  getWorkstation,
  listZones,
  updateProfile,
  updateWorkstationZone,
} from '../api/endpoints';
import { ApiError } from '../api/client';
import type { Profile, ProfileStatus, WorkstationFlag } from '../api/types';
import { errorMessage } from '../lib/errors';
import { formatAgo, formatDateTime, readiness } from '../lib/time';
import { useNow } from '../lib/useNow';
import { ReadinessBadge } from './WorkstationsPage';

const FLAG_LABELS: Record<WorkstationFlag, string> = {
  overdue_session: 'Quá giờ',
  stuck_sync: 'Kẹt đồng bộ',
  apply_error: 'Lỗi áp snapshot',
  missing_profile: 'Thiếu profile',
  ingest_rejects: 'Nhật ký lỗi',
  security_alert: 'Cảnh báo an ninh',
};

export function WorkstationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const workstationId = id ?? '';
  const queryClient = useQueryClient();

  const [pageError, setPageError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const disablingRef = useRef(false);
  const now = useNow();

  const {
    data: workstation,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['workstation', workstationId],
    queryFn: () => getWorkstation(workstationId),
    refetchInterval: 10000,
    enabled: Boolean(workstationId),
  });

  const { data: zones } = useQuery({
    queryKey: ['zones'],
    queryFn: listZones,
  });

  const handleZoneChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!workstation || actionLoading) return;
    const newZoneId = e.target.value ? e.target.value : null;
    setActionLoading(true);
    setPageError(null);
    try {
      await updateWorkstationZone(workstation.id, newZoneId);
      await queryClient.invalidateQueries({ queryKey: ['workstation', workstation.id] });
      await queryClient.invalidateQueries({ queryKey: ['workstations'] });
    } catch (err) {
      setPageError(errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleSetDefaultProfile = async (profile: Profile) => {
    if (!workstation || profile.is_default || actionLoading) return;
    setActionLoading(true);
    setPageError(null);
    try {
      await updateProfile(workstation.id, profile.os_username, { is_default: true });
      await queryClient.invalidateQueries({ queryKey: ['workstation', workstation.id] });
      await queryClient.invalidateQueries({ queryKey: ['workstations'] });
    } catch (err) {
      setPageError(errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleProfileStatus = async (profile: Profile) => {
    if (!workstation || actionLoading) return;
    const newStatus: ProfileStatus = profile.status === 'enabled' ? 'disabled' : 'enabled';
    if (profile.status === 'enabled' && profile.is_default) {
      const confirmed = window.confirm(
        'Đây là profile mặc định. Tắt nó thì các lịch không chỉ định profile sẽ bị từ chối ở máy này. Tiếp tục?',
      );
      if (!confirmed) return;
    }

    setActionLoading(true);
    setPageError(null);
    try {
      await updateProfile(workstation.id, profile.os_username, { status: newStatus });
      await queryClient.invalidateQueries({ queryKey: ['workstation', workstation.id] });
      await queryClient.invalidateQueries({ queryKey: ['workstations'] });
    } catch (err) {
      setPageError(errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisableWorkstation = async () => {
    if (!workstation || disablingRef.current || workstation.status !== 'enrolled') return;
    const promptMessage =
      'Gõ đúng tên máy ' +
      workstation.mqtt_identity +
      ' để vô hiệu hóa. Máy sẽ bị thu hồi chứng chỉ, không thể bật lại trừ khi cài lại và duyệt lại.';
    const typed = window.prompt(promptMessage);
    if (typed !== workstation.mqtt_identity) {
      return;
    }

    disablingRef.current = true;
    setActionLoading(true);
    setPageError(null);
    try {
      await disableWorkstation(workstation.id);
      await queryClient.invalidateQueries({ queryKey: ['workstation', workstation.id] });
      await queryClient.invalidateQueries({ queryKey: ['workstations'] });
    } catch (err) {
      setPageError(errorMessage(err));
    } finally {
      disablingRef.current = false;
      setActionLoading(false);
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center text-gray-500">Đang tải…</div>;
  }

  if (isError || !workstation) {
    const is404 =
      (error instanceof ApiError && error.status === 404) ||
      (error as { status?: number })?.status === 404 ||
      (error instanceof Error && error.message.includes('404')) ||
      !workstation;
    return (
      <div className="space-y-4">
        <Link to="/workstations" className="text-sm text-blue-600 hover:underline">
          ← Máy trạm
        </Link>
        <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200">
          {is404 ? 'Không tìm thấy máy' : errorMessage(error)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/workstations" className="text-sm text-blue-600 hover:underline">
          ← Máy trạm
        </Link>
      </div>

      {pageError && (
        <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200">
          {pageError}
        </div>
      )}

      {/* Header */}
      <div className="bg-white p-6 rounded-lg shadow space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{workstation.mqtt_identity}</h1>
            <p className="text-sm text-gray-500">{workstation.hostname}</p>
          </div>
          <div className="flex items-center space-x-3">
            <Link
              to={`/history?tab=audit&workstation_id=${encodeURIComponent(workstation.id)}`}
              className="text-sm text-blue-600 hover:underline"
            >
              Lịch sử quẹt thẻ
            </Link>
            <Link
              to={`/history?tab=sessions&workstation_id=${encodeURIComponent(workstation.id)}`}
              className="text-sm text-blue-600 hover:underline"
            >
              Phiên
            </Link>
            {workstation.status === 'enrolled' ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                Đã ghi danh
              </span>
            ) : (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                Đã vô hiệu hóa
              </span>
            )}
            <ReadinessBadge state={readiness(workstation, now)} />
          </div>
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="space-y-3">
            <div>
              <label htmlFor="zone-select" className="block text-gray-500 font-medium mb-1">
                Zone:
              </label>
              <select
                id="zone-select"
                value={workstation.zone?.id ?? ''}
                onChange={handleZoneChange}
                disabled={actionLoading}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Không thuộc zone —</option>
                {zones?.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="text-gray-500">Kết nối: </span>
              <span className="text-gray-900 font-medium">
                {workstation.connectivity === 'online' ? 'Online' : 'Offline'}
              </span>
              {workstation.last_heartbeat_at ? (
                <span className="text-gray-600">
                  {' '}· {formatDateTime(workstation.last_heartbeat_at)} ({formatAgo(workstation.last_heartbeat_at, now)})
                </span>
              ) : (
                <span className="text-gray-500"> · Chưa có heartbeat</span>
              )}
            </div>

            <div>
              <span className="text-gray-500">Trạng thái tin cậy: </span>
              <span className="text-gray-900 font-medium">{workstation.trust_state ?? '—'}</span>
            </div>

            <div>
              <span className="text-gray-500">Đồng bộ: </span>
              <span className="text-gray-900">
                {workstation.sync.state === 'in_sync' && <span>Đã đồng bộ</span>}
                {workstation.sync.state === 'pending' && <span>Đang chờ</span>}
                {workstation.sync.state === 'stuck' && (
                  <span className="text-red-600 font-medium">Kẹt</span>
                )}{' '}
                ({workstation.sync.acked_version}/{workstation.sync.desired_version})
              </span>
            </div>

            <div>
              <span className="text-gray-500">Đang dùng: </span>
              <span className="text-gray-900">
                {workstation.current_session ? (
                  <span>
                    {workstation.current_session.user.full_name} ({workstation.current_session.user.external_id})
                    {' '}— đến {formatDateTime(workstation.current_session.expires_at)}
                  </span>
                ) : (
                  '—'
                )}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <span className="text-gray-500">MAC: </span>
              <span className="text-gray-900 font-mono">{workstation.mac_address || '—'}</span>
            </div>

            <div>
              <span className="text-gray-500">Machine ID: </span>
              <span className="text-gray-900 font-mono text-xs">{workstation.machine_id || '—'}</span>
            </div>

            <div>
              <span className="text-gray-500">Key version: </span>
              <span className="text-gray-900 font-mono">{workstation.key_version}</span>
            </div>

            <div>
              <span className="text-gray-500">Chứng chỉ hết hạn: </span>
              <span className="text-gray-900">{formatDateTime(workstation.cert_expires_at)}</span>
            </div>

            <div>
              <span className="text-gray-500">Lỗi áp dụng snapshot: </span>
              {workstation.last_apply_error ? (
                <span className="text-red-600 font-medium">{workstation.last_apply_error}</span>
              ) : (
                <span className="text-gray-900">—</span>
              )}
            </div>

            <div>
              <span className="text-gray-500">Cảnh báo: </span>
              <div className="inline-flex flex-wrap gap-1 align-middle">
                {workstation.flags.map((flag) => {
                  const label = FLAG_LABELS[flag] || flag;
                  if (flag === 'ingest_rejects' || flag === 'security_alert') {
                    return (
                      <Link
                        key={flag}
                        to={`/issues?workstation_id=${encodeURIComponent(workstation.id)}`}
                        className="inline-block px-1.5 py-0.5 text-xs font-medium rounded bg-red-100 text-red-800 hover:underline"
                      >
                        {label}
                      </Link>
                    );
                  }
                  return (
                    <span
                      key={flag}
                      className="inline-block px-1.5 py-0.5 text-xs font-medium rounded bg-red-100 text-red-800"
                    >
                      {label}
                    </span>
                  );
                })}
                {workstation.clock_skew_detected && (
                  <span className="inline-block px-1.5 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800">
                    Lệch giờ
                  </span>
                )}
                {workstation.flags.length === 0 && !workstation.clock_skew_detected && (
                  <span className="text-gray-400">—</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Profiles Section */}
      <div className="bg-white p-6 rounded-lg shadow space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Profile</h2>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-gray-600 font-medium">
              <tr>
                <th className="px-4 py-3 text-left">Tài khoản OS</th>
                <th className="px-4 py-3 text-left">Tên hiển thị</th>
                <th className="px-4 py-3 text-left">Trạng thái</th>
                <th className="px-4 py-3 text-center">Mặc định</th>
                <th className="px-4 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {workstation.profiles.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                    Máy chưa báo profile nào (Agent tự phát hiện tài khoản thuộc nhóm labstudent).
                  </td>
                </tr>
              ) : (
                workstation.profiles.map((profile) => (
                  <tr key={profile.os_username} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-medium text-gray-900">
                      {profile.os_username}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {profile.display_name || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {profile.status === 'enabled' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                          Bật
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                          Tắt
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="radio"
                        name="default_profile"
                        checked={profile.is_default}
                        disabled={actionLoading}
                        onChange={() => handleSetDefaultProfile(profile)}
                        aria-label={`Mặc định ${profile.os_username}`}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={() => handleToggleProfileStatus(profile)}
                        className={`text-xs px-2.5 py-1 rounded border disabled:opacity-50 ${
                          profile.status === 'enabled'
                            ? 'border-red-300 text-red-700 hover:bg-red-50'
                            : 'border-green-300 text-green-700 hover:bg-green-50'
                        }`}
                      >
                        {profile.status === 'enabled' ? 'Tắt' : 'Bật'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Disable Workstation (only when status is enrolled) */}
      {workstation.status === 'enrolled' && (
        <div className="bg-white p-6 rounded-lg shadow flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border border-red-200">
          <div>
            <h2 className="text-base font-bold text-red-700">Vô hiệu hóa máy</h2>
            <p className="text-xs text-gray-500 mt-1">
              Máy sẽ bị thu hồi chứng chỉ và chuyển sang trạng thái đã vô hiệu hóa.
            </p>
          </div>
          <button
            type="button"
            disabled={actionLoading}
            onClick={handleDisableWorkstation}
            className="px-4 py-2 border border-red-600 text-red-600 rounded text-sm font-medium hover:bg-red-50 disabled:opacity-50"
          >
            Vô hiệu hóa máy
          </button>
        </div>
      )}
    </div>
  );
}
