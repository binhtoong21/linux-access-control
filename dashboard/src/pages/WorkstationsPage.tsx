import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listWorkstations, type WorkstationFilter } from '../api/endpoints';
import type { WorkstationFlag } from '../api/types';
import { formatAgo, formatTime, readiness, type ReadinessState } from '../lib/time';

const FLAG_LABELS: Record<WorkstationFlag, string> = {
  overdue_session: 'Quá giờ',
  stuck_sync: 'Kẹt đồng bộ',
  apply_error: 'Lỗi áp snapshot',
  missing_profile: 'Thiếu profile',
  ingest_rejects: 'Nhật ký lỗi',
  security_alert: 'Cảnh báo an ninh',
};

export function ReadinessBadge({ state }: { state: ReadinessState }) {
  switch (state) {
    case 'ready':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
          Sẵn sàng
        </span>
      );
    case 'offline_ok':
      return (
        <span
          title="Máy vẫn cho quẹt thẻ theo dữ liệu đã nhận đến khi hết hạn tin cậy"
          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800"
        >
          Offline, còn dữ liệu
        </span>
      );
    case 'lease_expired':
      return (
        <span
          title="Máy sẽ từ chối quẹt thẻ cho đến khi kết nối lại server. Bật máy trước giờ sử dụng."
          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800"
        >
          Hết hạn tin cậy
        </span>
      );
    case 'no_data':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
          Chưa có dữ liệu
        </span>
      );
    case 'clock_invalid':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
          Đồng hồ sai
        </span>
      );
    case 'disabled':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
          Đã vô hiệu hóa
        </span>
      );
  }
}

export function WorkstationsPage() {
  const [connectivityFilter, setConnectivityFilter] = useState<'all' | 'online' | 'offline'>('all');

  const filter = useMemo<WorkstationFilter | undefined>(() => {
    if (connectivityFilter === 'all') return undefined;
    return { connectivity: connectivityFilter };
  }, [connectivityFilter]);

  const { data, isLoading, isError, error, dataUpdatedAt } = useQuery({
    queryKey: ['workstations', filter],
    queryFn: () => listWorkstations(filter),
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl font-bold text-gray-900">Danh sách máy trạm</h1>
        <div className="flex items-center space-x-2">
          <label htmlFor="connectivity-filter" className="text-sm font-medium text-gray-700">
            Kết nối:
          </label>
          <select
            id="connectivity-filter"
            value={connectivityFilter}
            onChange={(e) => setConnectivityFilter(e.target.value as 'all' | 'online' | 'offline')}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Tất cả</option>
            <option value="online">Đang online</option>
            <option value="offline">Offline</option>
          </select>
        </div>
      </div>

      {isError && data && (
        <div className="p-3 bg-amber-50 text-amber-700 text-sm rounded border border-amber-200">
          Mất kết nối, đang thử lại…
        </div>
      )}

      {isLoading && (
        <div className="p-8 text-center text-gray-500">Đang tải…</div>
      )}

      {isError && !data && (
        <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200">
          {error instanceof Error ? error.message : 'Không kết nối được máy chủ'}
        </div>
      )}

      {!isLoading && data && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-gray-600 font-medium">
                <tr>
                  <th className="px-4 py-3 text-left">Máy</th>
                  <th className="px-4 py-3 text-left">Zone</th>
                  <th className="px-4 py-3 text-left">Kết nối</th>
                  <th className="px-4 py-3 text-left">Sẵn sàng</th>
                  <th className="px-4 py-3 text-left">Đang dùng</th>
                  <th className="px-4 py-3 text-left">Đồng bộ</th>
                  <th className="px-4 py-3 text-left">Cảnh báo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {data.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      Chưa có máy nào
                    </td>
                  </tr>
                ) : (
                  data.map((ws) => (
                    <tr key={ws.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link
                          to={`/workstations/${encodeURIComponent(ws.id)}`}
                          className="font-medium text-blue-600 hover:underline"
                        >
                          {ws.hostname}
                        </Link>
                        <div className="text-xs text-gray-500">{ws.mqtt_identity}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {ws.zone ? ws.zone.name : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          {ws.connectivity === 'online' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                              Online
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                              Offline
                            </span>
                          )}
                        </div>
                        {ws.last_heartbeat_at && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            {formatAgo(ws.last_heartbeat_at)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <ReadinessBadge state={readiness(ws)} />
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {ws.current_session ? (
                          <div>
                            <div>
                              {ws.current_session.user.full_name} ({ws.current_session.user.external_id})
                            </div>
                            <div className="text-xs text-gray-500">
                              đến {formatTime(ws.current_session.expires_at)}
                            </div>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {ws.sync.state === 'in_sync' && <span>Đã đồng bộ</span>}
                        {ws.sync.state === 'pending' && (
                          <span>
                            Đang chờ ({ws.sync.acked_version}/{ws.sync.desired_version})
                          </span>
                        )}
                        {ws.sync.state === 'stuck' && (
                          <span className="text-red-600 font-medium">
                            Kẹt ({ws.sync.acked_version}/{ws.sync.desired_version})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {ws.flags.map((flag) => (
                            <span
                              key={flag}
                              className="inline-block px-1.5 py-0.5 text-xs font-medium rounded bg-red-100 text-red-800"
                            >
                              {FLAG_LABELS[flag] || flag}
                            </span>
                          ))}
                          {ws.clock_skew_detected && (
                            <span className="inline-block px-1.5 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800">
                              Lệch giờ
                            </span>
                          )}
                          {ws.flags.length === 0 && !ws.clock_skew_detected && (
                            <span className="text-gray-400">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dataUpdatedAt > 0 && (
        <div className="text-xs text-gray-500 text-right">
          Cập nhật lúc {formatTime(dataUpdatedAt, true)}
        </div>
      )}
    </div>
  );
}
