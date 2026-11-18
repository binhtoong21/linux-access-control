import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listWorkstations, type WorkstationFilter } from '../api/endpoints';
import type { WorkstationFlag } from '../api/types';
import { formatAgo, formatTime, readiness, type ReadinessState } from '../lib/time';
import { useNow } from '../lib/useNow';
import {
  Button,
  EmptyRow,
  Notice,
  PageHeader,
  StatusPill,
  Table,
  TD,
  TH,
  THead,
  TR,
} from '../components/ui';

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
      return <StatusPill tone="ok">Sẵn sàng</StatusPill>;
    case 'offline_ok':
      return (
        <StatusPill
          tone="warn"
          title="Máy vẫn cho quẹt thẻ theo dữ liệu đã nhận đến khi hết hạn tin cậy"
        >
          Offline, còn dữ liệu
        </StatusPill>
      );
    case 'offline_unknown':
      return (
        <StatusPill
          tone="warn"
          title="Lần cuối kết nối, máy chưa chạy dữ liệu mới nhất nên không biết hạn tin cậy còn bao lâu. Bật máy để kiểm tra."
        >
          Offline, không rõ
        </StatusPill>
      );
    case 'lease_expired':
      return (
        <StatusPill
          tone="danger"
          title="Máy sẽ từ chối quẹt thẻ cho đến khi kết nối lại server. Bật máy trước giờ sử dụng."
        >
          Hết hạn tin cậy
        </StatusPill>
      );
    case 'no_data':
      return <StatusPill tone="neutral">Chưa có dữ liệu</StatusPill>;
    case 'clock_invalid':
      return <StatusPill tone="danger">Đồng hồ sai</StatusPill>;
    case 'disabled':
      return <StatusPill tone="neutral">Đã vô hiệu hóa</StatusPill>;
  }
}

export function WorkstationsPage() {
  const [connectivityFilter, setConnectivityFilter] = useState<'all' | 'online' | 'offline'>('all');
  const now = useNow();

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
      <PageHeader
        title="Máy trạm"
        description="Trạng thái các máy trạm, cập nhật mỗi 5 giây."
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant={connectivityFilter === 'all' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setConnectivityFilter('all')}
            >
              Tất cả
            </Button>
            <Button
              variant={connectivityFilter === 'online' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setConnectivityFilter('online')}
            >
              Online
            </Button>
            <Button
              variant={connectivityFilter === 'offline' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setConnectivityFilter('offline')}
            >
              Offline
            </Button>
          </div>
        }
      />

      {isError && data && (
        <Notice tone="warn">Mất kết nối, đang thử lại…</Notice>
      )}

      {isLoading && (
        <div className="py-8 text-center text-sm text-ink-muted">Đang tải…</div>
      )}

      {isError && !data && (
        <Notice tone="danger">
          {error instanceof Error ? error.message : 'Không kết nối được máy chủ'}
        </Notice>
      )}

      {!isLoading && data && (
        <Table>
          <THead>
            <TR>
              <TH>Máy</TH>
              <TH>Zone</TH>
              <TH>Kết nối</TH>
              <TH>Sẵn sàng</TH>
              <TH>Đang dùng</TH>
              <TH>Đồng bộ</TH>
              <TH>Cảnh báo</TH>
            </TR>
          </THead>
          <tbody>
            {data.length === 0 ? (
              <EmptyRow colSpan={7}>Chưa có máy nào</EmptyRow>
            ) : (
              data.map((ws) => (
                <TR key={ws.id} interactive>
                  <TD>
                    <Link
                      to={`/workstations/${encodeURIComponent(ws.id)}`}
                      className="font-mono font-medium text-accent hover:underline block"
                    >
                      {ws.mqtt_identity}
                    </Link>
                    <div className="text-xs text-ink-muted">{ws.hostname}</div>
                  </TD>
                  <TD className="text-ink">
                    {ws.zone ? ws.zone.name : '—'}
                  </TD>
                  <TD>
                    <div>
                      <StatusPill tone={ws.connectivity === 'online' ? 'ok' : 'neutral'}>
                        {ws.connectivity === 'online' ? 'Online' : 'Offline'}
                      </StatusPill>
                    </div>
                    {ws.last_heartbeat_at && (
                      <div className="text-xs text-ink-muted mt-0.5">
                        {formatAgo(ws.last_heartbeat_at, now)}
                      </div>
                    )}
                  </TD>
                  <TD>
                    <ReadinessBadge state={readiness(ws, now)} />
                  </TD>
                  <TD className="text-ink">
                    {ws.current_session ? (
                      <div>
                        <div>
                          {ws.current_session.user.full_name} ({ws.current_session.user.external_id})
                        </div>
                        <div className="text-xs text-ink-muted">
                          đến {formatTime(ws.current_session.expires_at)}
                        </div>
                      </div>
                    ) : (
                      '—'
                    )}
                  </TD>
                  <TD>
                    {ws.sync.state === 'in_sync' && (
                      <StatusPill tone="ok">Đã đồng bộ</StatusPill>
                    )}
                    {ws.sync.state === 'pending' && (
                      <StatusPill tone="info">
                        Đang chờ ({ws.sync.acked_version}/{ws.sync.desired_version})
                      </StatusPill>
                    )}
                    {ws.sync.state === 'stuck' && (
                      <StatusPill tone="danger">
                        Kẹt ({ws.sync.acked_version}/{ws.sync.desired_version})
                      </StatusPill>
                    )}
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {ws.flags.map((flag) => {
                        const label = FLAG_LABELS[flag] || flag;
                        const tone = flag === 'missing_profile' ? 'warn' : 'danger';
                        if (flag === 'ingest_rejects' || flag === 'security_alert') {
                          return (
                            <Link
                              key={flag}
                              to={`/issues?workstation_id=${encodeURIComponent(ws.id)}`}
                              className="hover:underline"
                            >
                              <StatusPill tone={tone}>{label}</StatusPill>
                            </Link>
                          );
                        }
                        return (
                          <StatusPill key={flag} tone={tone}>
                            {label}
                          </StatusPill>
                        );
                      })}
                      {ws.clock_skew_detected && (
                        <StatusPill tone="warn">Lệch giờ</StatusPill>
                      )}
                      {ws.flags.length === 0 && !ws.clock_skew_detected && (
                        <span className="text-ink-muted">—</span>
                      )}
                    </div>
                  </TD>
                </TR>
              ))
            )}
          </tbody>
        </Table>
      )}

      {dataUpdatedAt > 0 && (
        <div className="text-xs text-ink-muted text-right">
          Cập nhật lúc {formatTime(dataUpdatedAt, true)}
        </div>
      )}
    </div>
  );
}
