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
import {
  Button,
  ConfirmDialog,
  EmptyRow,
  Field,
  Notice,
  PageHeader,
  selectClass,
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

export function WorkstationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const workstationId = id ?? '';
  const queryClient = useQueryClient();

  const [pageError, setPageError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [profileToDisable, setProfileToDisable] = useState<Profile | null>(null);
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
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

  const executeToggleProfile = async (profile: Profile) => {
    if (!workstation || actionLoading) return;
    const newStatus: ProfileStatus = profile.status === 'enabled' ? 'disabled' : 'enabled';
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

  const handleToggleProfileStatus = (profile: Profile) => {
    if (!workstation || actionLoading) return;
    if (profile.status === 'enabled' && profile.is_default) {
      setProfileToDisable(profile);
      return;
    }
    void executeToggleProfile(profile);
  };

  const handleDisableConfirm = async () => {
    if (!workstation || disablingRef.current || workstation.status !== 'enrolled') return;
    disablingRef.current = true;
    setActionLoading(true);
    setPageError(null);
    try {
      await disableWorkstation(workstation.id);
      await queryClient.invalidateQueries({ queryKey: ['workstation', workstation.id] });
      await queryClient.invalidateQueries({ queryKey: ['workstations'] });
      setDisableDialogOpen(false);
    } catch (err) {
      setPageError(errorMessage(err));
      throw err;
    } finally {
      disablingRef.current = false;
      setActionLoading(false);
    }
  };

  if (isLoading) {
    return <div className="py-8 text-center text-sm text-ink-muted">Đang tải…</div>;
  }

  if (isError || !workstation) {
    const is404 =
      (error instanceof ApiError && error.status === 404) ||
      (error as { status?: number })?.status === 404 ||
      (error instanceof Error && error.message.includes('404')) ||
      !workstation;
    return (
      <div className="space-y-4">
        <div>
          <Link to="/workstations" className="text-sm text-accent hover:underline">
            Máy trạm
          </Link>
        </div>
        <Notice tone="danger">
          {is404 ? 'Không tìm thấy máy' : errorMessage(error)}
        </Notice>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/workstations" className="text-sm text-accent hover:underline">
          Máy trạm
        </Link>
      </div>

      {pageError && (
        <Notice tone="danger">{pageError}</Notice>
      )}

      {/* Header */}
      <PageHeader
        title={<span className="font-mono">{workstation.mqtt_identity}</span>}
        description={workstation.hostname}
        actions={
          <>
            <Link
              to={`/history?tab=audit&workstation_id=${encodeURIComponent(workstation.id)}`}
              className="inline-flex items-center justify-center font-medium rounded transition-colors bg-transparent text-accent hover:bg-accent-tint h-8 px-3 text-sm"
            >
              Lịch sử quẹt thẻ
            </Link>
            <Link
              to={`/history?tab=sessions&workstation_id=${encodeURIComponent(workstation.id)}`}
              className="inline-flex items-center justify-center font-medium rounded transition-colors bg-transparent text-accent hover:bg-accent-tint h-8 px-3 text-sm"
            >
              Phiên
            </Link>
            <StatusPill tone={workstation.status === 'enrolled' ? 'ok' : 'neutral'}>
              {workstation.status === 'enrolled' ? 'Đã ghi danh' : 'Đã vô hiệu hóa'}
            </StatusPill>
            <ReadinessBadge state={readiness(workstation, now)} />
          </>
        }
      />

      {/* Info panel */}
      <div className="bg-surface border border-line rounded p-6">
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 text-sm">
          <div className="space-y-4">
            <div>
              <Field label="Zone:" htmlFor="zone-select">
                <select
                  id="zone-select"
                  value={workstation.zone?.id ?? ''}
                  onChange={handleZoneChange}
                  disabled={actionLoading}
                  className={`w-full ${selectClass}`}
                >
                  <option value="">— Không thuộc zone —</option>
                  {zones?.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div>
              <dt className="text-xs font-medium text-ink-muted">Kết nối</dt>
              <dd className="text-sm text-ink mt-0.5">
                <span className="font-medium">
                  {workstation.connectivity === 'online' ? 'Online' : 'Offline'}
                </span>
                {workstation.last_heartbeat_at ? (
                  <span className="text-ink-muted">
                    {' '}· {formatDateTime(workstation.last_heartbeat_at)} ({formatAgo(workstation.last_heartbeat_at, now)})
                  </span>
                ) : (
                  <span className="text-ink-muted"> · Chưa có heartbeat</span>
                )}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium text-ink-muted">Trạng thái tin cậy</dt>
              <dd className="text-sm text-ink font-medium mt-0.5">
                {workstation.trust_state ?? '—'}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium text-ink-muted">Đồng bộ</dt>
              <dd className="text-sm text-ink mt-0.5">
                {workstation.sync.state === 'in_sync' && <span>Đã đồng bộ</span>}
                {workstation.sync.state === 'pending' && <span>Đang chờ</span>}
                {workstation.sync.state === 'stuck' && (
                  <span className="text-danger font-medium">Kẹt</span>
                )}{' '}
                ({workstation.sync.acked_version}/{workstation.sync.desired_version})
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium text-ink-muted">Đang dùng</dt>
              <dd className="text-sm text-ink mt-0.5">
                {workstation.current_session ? (
                  <span>
                    {workstation.current_session.user.full_name} ({workstation.current_session.user.external_id})
                    {' '}— đến {formatDateTime(workstation.current_session.expires_at)}
                  </span>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <dt className="text-xs font-medium text-ink-muted">MAC</dt>
              <dd className="text-sm text-ink font-mono mt-0.5">{workstation.mac_address || '—'}</dd>
            </div>

            <div>
              <dt className="text-xs font-medium text-ink-muted">Machine ID</dt>
              <dd className="text-sm text-ink font-mono text-xs mt-0.5">{workstation.machine_id || '—'}</dd>
            </div>

            <div>
              <dt className="text-xs font-medium text-ink-muted">Key version</dt>
              <dd className="text-sm text-ink font-mono mt-0.5">{workstation.key_version}</dd>
            </div>

            <div>
              <dt className="text-xs font-medium text-ink-muted">Chứng chỉ hết hạn</dt>
              <dd className="text-sm text-ink mt-0.5">{formatDateTime(workstation.cert_expires_at)}</dd>
            </div>

            <div>
              <dt className="text-xs font-medium text-ink-muted">Lỗi áp dụng snapshot</dt>
              <dd className="text-sm mt-0.5">
                {workstation.last_apply_error ? (
                  <span className="text-danger font-medium">{workstation.last_apply_error}</span>
                ) : (
                  <span className="text-ink">—</span>
                )}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium text-ink-muted">Cảnh báo</dt>
              <dd className="text-sm mt-0.5">
                <div className="inline-flex flex-wrap gap-1 align-middle">
                  {workstation.flags.map((flag) => {
                    const label = FLAG_LABELS[flag] || flag;
                    const tone = flag === 'missing_profile' ? 'warn' : 'danger';
                    if (flag === 'ingest_rejects' || flag === 'security_alert') {
                      return (
                        <Link
                          key={flag}
                          to={`/issues?workstation_id=${encodeURIComponent(workstation.id)}`}
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
                  {workstation.clock_skew_detected && (
                    <StatusPill tone="warn">Lệch giờ</StatusPill>
                  )}
                  {workstation.flags.length === 0 && !workstation.clock_skew_detected && (
                    <span className="text-ink-muted">—</span>
                  )}
                </div>
              </dd>
            </div>
          </div>
        </dl>
      </div>

      {/* Profiles */}
      <div className="bg-surface border border-line rounded p-6 space-y-4">
        <h2 className="text-base font-semibold text-ink">Profile</h2>

        <Table>
          <THead>
            <TR>
              <TH>Tài khoản OS</TH>
              <TH>Tên hiển thị</TH>
              <TH>Trạng thái</TH>
              <TH className="text-center">Mặc định</TH>
              <TH className="text-right">Thao tác</TH>
            </TR>
          </THead>
          <tbody>
            {workstation.profiles.length === 0 ? (
              <EmptyRow colSpan={5}>
                Máy chưa báo profile nào (Agent tự phát hiện tài khoản thuộc nhóm labstudent).
              </EmptyRow>
            ) : (
              workstation.profiles.map((profile) => (
                <TR key={profile.os_username} interactive>
                  <TD className="font-mono font-medium text-ink">
                    {profile.os_username}
                  </TD>
                  <TD className="text-ink-muted">
                    {profile.display_name || '—'}
                  </TD>
                  <TD>
                    <StatusPill tone={profile.status === 'enabled' ? 'ok' : 'neutral'}>
                      {profile.status === 'enabled' ? 'Bật' : 'Tắt'}
                    </StatusPill>
                  </TD>
                  <TD className="text-center">
                    <input
                      type="radio"
                      name="default_profile"
                      checked={profile.is_default}
                      disabled={actionLoading}
                      onChange={() => handleSetDefaultProfile(profile)}
                      aria-label={`Mặc định ${profile.os_username}`}
                      className="h-4 w-4 accent-accent"
                    />
                  </TD>
                  <TD className="text-right">
                    <Button
                      size="sm"
                      variant={profile.status === 'enabled' ? 'danger' : 'secondary'}
                      disabled={actionLoading}
                      onClick={() => handleToggleProfileStatus(profile)}
                    >
                      {profile.status === 'enabled' ? 'Tắt' : 'Bật'}
                    </Button>
                  </TD>
                </TR>
              ))
            )}
          </tbody>
        </Table>
      </div>

      {/* Danger zone (only when enrolled) */}
      {workstation.status === 'enrolled' && (
        <div className="bg-surface border border-line rounded p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-danger">Vô hiệu hóa máy</h2>
            <p className="text-xs text-ink-muted mt-1">
              Máy sẽ bị thu hồi chứng chỉ và chuyển sang trạng thái đã vô hiệu hóa.
            </p>
          </div>
          <Button
            variant="danger"
            disabled={actionLoading}
            onClick={() => setDisableDialogOpen(true)}
          >
            Vô hiệu hóa máy
          </Button>
        </div>
      )}

      {/* ConfirmDialog: Turn off default profile */}
      <ConfirmDialog
        open={profileToDisable !== null}
        title="Tắt profile mặc định?"
        message="Đây là profile mặc định. Tắt nó thì các lịch không chỉ định profile sẽ bị từ chối ở máy này. Tiếp tục?"
        confirmLabel="Tắt profile"
        tone="danger"
        onConfirm={async () => {
          if (!profileToDisable) return;
          const target = profileToDisable;
          setProfileToDisable(null);
          await executeToggleProfile(target);
        }}
        onCancel={() => setProfileToDisable(null)}
      />

      {/* ConfirmDialog: Disable workstation */}
      <ConfirmDialog
        open={disableDialogOpen}
        title={`Vô hiệu hóa máy ${workstation.mqtt_identity}?`}
        message="Máy bị thu hồi chứng chỉ ngay. Máy vẫn cho quẹt thẻ đến khi hết hạn tin cậy (tối đa 24 giờ). Không thể bật lại, trừ khi cài lại và duyệt lại."
        confirmLabel="Vô hiệu hóa"
        tone="danger"
        requireText={workstation.mqtt_identity}
        onConfirm={handleDisableConfirm}
        onCancel={() => setDisableDialogOpen(false)}
      />
    </div>
  );
}
