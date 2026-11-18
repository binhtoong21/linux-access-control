import React, { useRef, useState, useEffect } from 'react';
import {
  Button,
  ConfirmDialog,
  EmptyRow,
  Field,
  fieldDescribedBy,
  inputClass,
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
  approveEnrollmentBatch,
  approveEnrollmentNew,
  approveEnrollmentReinstall,
  listEnrollmentRequests,
  listZones,
  rejectEnrollment,
} from '../api/endpoints';
import type { BatchApprovalResult, EnrollmentRequest, EnrollmentStatus } from '../api/types';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/time';

const MQTT_IDENTITY_REGEX = /^[A-Za-z0-9_-]{3,64}$/;
const NAME_PREFIX_REGEX = /^[A-Za-z0-9_-]{1,60}$/;

function formatBatchSkipReason(reason: string): string {
  switch (reason) {
    case 'duplicate':
      return 'trùng máy, cần duyệt cài lại';
    case 'not_pending':
      return 'không còn chờ duyệt';
    case 'not_found':
      return 'không tìm thấy';
    default:
      return reason;
  }
}

export function EnrollmentPage() {
  const queryClient = useQueryClient();
  const inFlightRef = useRef(false);
  const [reinstallTarget, setReinstallTarget] = useState<EnrollmentRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<EnrollmentRequest | null>(null);

  const [status, setStatus] = useState<EnrollmentStatus>('pending');
  const [inFlight, setInFlight] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  // Batch selection
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [batchZoneId, setBatchZoneId] = useState('');
  const [namePrefix, setNamePrefix] = useState('');
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<BatchApprovalResult | null>(null);

  // Inline approve form
  const [approvingRowId, setApprovingRowId] = useState<string | null>(null);
  const [newMqttIdentity, setNewMqttIdentity] = useState('');
  const [newZoneId, setNewZoneId] = useState('');
  const [inlineApproveError, setInlineApproveError] = useState<string | null>(null);

  const {
    data: requests,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['enrollment', status],
    queryFn: () => listEnrollmentRequests(status),
    refetchInterval: status === 'pending' ? 10000 : false,
  });

  const { data: zones } = useQuery({
    queryKey: ['zones'],
    queryFn: listZones,
  });

  useEffect(() => {
    if (zones && zones.length > 0 && !batchZoneId) {
      setBatchZoneId(zones[0].id);
    }
  }, [zones, batchZoneId]);

  const handleTabChange = (newStatus: EnrollmentStatus) => {
    setStatus(newStatus);
    setCheckedIds([]);
    setBatchResult(null);
    setBatchError(null);
    setApprovingRowId(null);
    setInlineApproveError(null);
    setPageError(null);
  };

  const handleToggleCheck = (id: string) => {
    setCheckedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleOpenInlineApprove = (req: EnrollmentRequest) => {
    setApprovingRowId(req.id);
    setNewMqttIdentity(MQTT_IDENTITY_REGEX.test(req.hostname) ? req.hostname : '');
    setNewZoneId('');
    setInlineApproveError(null);
    setPageError(null);
  };

  const handleCancelInlineApprove = () => {
    setApprovingRowId(null);
    setInlineApproveError(null);
  };

  const handleSubmitInlineApprove = async (id: string) => {
    setInlineApproveError(null);
    setPageError(null);

    const trimmedIdentity = newMqttIdentity.trim();
    if (!MQTT_IDENTITY_REGEX.test(trimmedIdentity)) {
      setInlineApproveError(
        'Tên máy không đúng định dạng (cần 3-64 ký tự A-Z, a-z, 0-9, _, -).',
      );
      return;
    }

    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setInFlight(true);

    try {
      await approveEnrollmentNew(id, {
        mqtt_identity: trimmedIdentity,
        zone_id: newZoneId || null,
      });
      await queryClient.invalidateQueries({ queryKey: ['enrollment'] });
      await queryClient.invalidateQueries({ queryKey: ['workstations'] });
      setApprovingRowId(null);
    } catch (err) {
      setInlineApproveError(errorMessage(err));
    } finally {
      inFlightRef.current = false;
      setInFlight(false);
    }
  };

  const handleApproveReinstall = async (req: EnrollmentRequest) => {
    if (!req.duplicate_of) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setInFlight(true);
    setPageError(null);

    try {
      await approveEnrollmentReinstall(req.id);
      await queryClient.invalidateQueries({ queryKey: ['enrollment'] });
      await queryClient.invalidateQueries({ queryKey: ['workstations'] });
      setReinstallTarget(null);
    } finally {
      inFlightRef.current = false;
      setInFlight(false);
    }
  };

  const handleReject = async (id: string, note: string) => {

    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setInFlight(true);
    setPageError(null);

    try {
      await rejectEnrollment(id, note.trim() || undefined);
      await queryClient.invalidateQueries({ queryKey: ['enrollment'] });
      await queryClient.invalidateQueries({ queryKey: ['workstations'] });
      setRejectTarget(null);
    } finally {
      inFlightRef.current = false;
      setInFlight(false);
    }
  };

  const handleApproveBatch = async () => {
    setBatchError(null);
    setPageError(null);

    const trimmedPrefix = namePrefix.trim();
    if (!NAME_PREFIX_REGEX.test(trimmedPrefix)) {
      setBatchError('Tiền tố tên không hợp lệ (cần 1-60 ký tự A-Z, a-z, 0-9, _, -).');
      return;
    }

    if (!batchZoneId) {
      setBatchError('Vui lòng chọn zone.');
      return;
    }

    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setInFlight(true);

    try {
      const result = await approveEnrollmentBatch({
        zone_id: batchZoneId,
        request_ids: checkedIds,
        name_prefix: trimmedPrefix,
      });
      setBatchResult(result);
      setCheckedIds([]);
      await queryClient.invalidateQueries({ queryKey: ['enrollment'] });
      await queryClient.invalidateQueries({ queryKey: ['workstations'] });
    } catch (err) {
      setBatchError(errorMessage(err));
    } finally {
      inFlightRef.current = false;
      setInFlight(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Duyệt máy" />

      {pageError && (
        <Notice tone="danger">{pageError}</Notice>
      )}

      {/* Status tabs */}
      <div className="border-b border-line">
        <nav className="-mb-px flex space-x-8">
          <Button
            variant={status === 'pending' ? 'primary' : 'secondary'}
            aria-pressed={status === 'pending'}
            type="button"
            onClick={() => handleTabChange('pending')}
          >
            Đang chờ
          </Button>
          <Button
            variant={status === 'approved' ? 'primary' : 'secondary'}
            aria-pressed={status === 'approved'}
            type="button"
            onClick={() => handleTabChange('approved')}
          >
            Đã duyệt
          </Button>
          <Button
            variant={status === 'rejected' ? 'primary' : 'secondary'}
            aria-pressed={status === 'rejected'}
            type="button"
            onClick={() => handleTabChange('rejected')}
          >
            Đã từ chối
          </Button>
        </nav>
      </div>

      {/* Batch Bar (only on pending when >= 1 row checked) */}
      {status === 'pending' && checkedIds.length > 0 && (
        <div className="bg-accent-tint border border-accent rounded p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <span className="font-semibold text-sm text-accent">
              Đã chọn {checkedIds.length} máy
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field htmlFor="batch-zone" label="Zone *">
              <select
                id="batch-zone"
                value={batchZoneId}
                onChange={(e) => setBatchZoneId(e.target.value)}
                disabled={inFlight}
                className={`w-full ${selectClass}`}
              >
                {zones?.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              htmlFor="batch-prefix"
              label="Tiền tố tên *"
              error={batchError}
              hint={<>Tên máy sẽ là <span className="font-mono">{namePrefix || '{prefix}'}NN</span>, nối tiếp số lớn nhất đã dùng.</>}
            >
              <input
                id="batch-prefix"
                aria-describedby={fieldDescribedBy('batch-prefix', { error: batchError, hint: true })}
                type="text"
                value={namePrefix}
                onChange={(e) => {
                  setNamePrefix(e.target.value);
                  setBatchError(null);
                }}
                placeholder="Ví dụ: lab-pc-"
                disabled={inFlight}
                className={`w-full font-mono ${inputClass}`}
              />
            </Field>
          </div>



          <div className="flex justify-end">
            <Button
              variant="primary"
              type="button"
              disabled={inFlight || !batchZoneId}
              onClick={handleApproveBatch}
            >
              Duyệt {checkedIds.length} máy
            </Button>
          </div>
        </div>
      )}

      {/* Batch Results Banner */}
      {batchResult && (
        <Notice tone={batchResult.skipped.length ? 'warn' : 'ok'}>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">Kết quả duyệt hàng loạt</h2>
            <Button
              variant="quiet"
              type="button"
              onClick={() => setBatchResult(null)}
            >
              Đóng
            </Button>
          </div>
          {batchResult.approved.length > 0 && (
            <div>
              <StatusPill tone="ok">Đã duyệt: </StatusPill>
              <span className="text-xs text-ink font-mono">
                {batchResult.approved.map((item) => item.mqtt_identity).join(', ')}
              </span>
            </div>
          )}
          {batchResult.skipped.length > 0 && (
            <div className="space-y-1">
              <StatusPill tone="warn">Bỏ qua:</StatusPill>
              <ul className="text-xs text-ink list-disc list-inside">
                {batchResult.skipped.map((item) => (
                  <li key={item.id}>
                    Yêu cầu <span className="font-mono">{item.id}</span>: {formatBatchSkipReason(item.reason)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Notice>
      )}

      {isLoading && <Notice tone="info">Đang tải…</Notice>}

      {isError && (
        <Notice tone="danger">{errorMessage(error)}</Notice>
      )}

      {!isLoading && !isError && (
        <>
          {status === 'pending' ? (
            <Table>
              <THead>
                <TR>
                  <TH className="w-10 text-center"></TH>
                  <TH className="text-left">Hostname</TH>
                  <TH className="text-left">MAC</TH>
                  <TH className="text-left">Machine ID</TH>
                  <TH className="text-left">Gửi lúc</TH>
                  <TH className="text-left">Trùng</TH>
                  <TH className="text-right">Thao tác</TH>
                </TR>
              </THead>
              <tbody>
                {requests && requests.length > 0 ? (
                  requests.map((req) => {
                    const isRowApproving = approvingRowId === req.id;
                    const hasDuplicateMac = req.duplicate_mac_detected;
                    const isReinstall = Boolean(req.duplicate_of);
                    const isDuplicateOther = hasDuplicateMac && !isReinstall;

                    return (
                      <React.Fragment key={req.id}>
                        <TR className="hover:bg-canvas">
                          <TD className="text-center">
                            {!hasDuplicateMac && (
                              <input
                                type="checkbox"
                                checked={checkedIds.includes(req.id)}
                                onChange={() => handleToggleCheck(req.id)}
                                aria-label={`Chọn ${req.hostname}`}
                                disabled={inFlight}
                                className="h-4 w-4 rounded border-control accent-accent focus:ring-accent"
                              />
                            )}
                          </TD>
                          <TD className="font-medium text-ink">{req.hostname}</TD>
                          <TD className="font-mono text-ink">{req.mac_address}</TD>
                          <TD>
                            <span title={req.machine_id} className="font-mono text-xs text-ink-muted">
                              {req.machine_id.length > 12
                                ? `${req.machine_id.slice(0, 12)}…`
                                : req.machine_id}
                            </span>
                          </TD>
                          <TD className="text-ink-muted">
                            {formatDateTime(req.submitted_at)}
                          </TD>
                          <TD className="text-xs">
                            {isReinstall && req.duplicate_of && (
                              <StatusPill tone="warn">
                                Trùng máy <span className="font-mono">{req.duplicate_of.mqtt_identity}</span>
                              </StatusPill>
                            )}
                            {isDuplicateOther && (
                              <StatusPill tone="warn">
                                Trùng yêu cầu khác đang chờ
                              </StatusPill>
                            )}
                            {!hasDuplicateMac && !isReinstall && (
                              <span className="text-ink-muted">—</span>
                            )}
                          </TD>
                          <TD className="text-right space-x-2">
                            {!hasDuplicateMac && !isReinstall && !isRowApproving && (
                              <Button
                                variant="quiet"
                                type="button"
                                disabled={inFlight}
                                onClick={() => handleOpenInlineApprove(req)}
                              >
                                Duyệt
                              </Button>
                            )}
                            {isReinstall && req.duplicate_of && (
                              <Button
                                variant="quiet"
                                type="button"
                                disabled={inFlight}
                                onClick={() => setReinstallTarget(req)}
                              >
                                Duyệt cài lại <span className="font-mono">{req.duplicate_of.mqtt_identity}</span>
                              </Button>
                            )}
                            {isDuplicateOther && (
                              <span className="text-xs text-ink-muted mr-2">
                                Duyệt yêu cầu kia trước; yêu cầu này sẽ thành cài lại.
                              </span>
                            )}
                            {!isRowApproving && (
                              <Button
                                variant="quiet"
                                type="button"
                                disabled={inFlight}
                                onClick={() => setRejectTarget(req)}
                              >
                                Từ chối
                              </Button>
                            )}
                          </TD>
                        </TR>

                        {/* Inline Approve Form Row */}
                        {isRowApproving && (
                          <TR className="bg-accent-tint">
                            <TD colSpan={7}>
                              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                <Field htmlFor="new-identity" label="Tên máy" error={inlineApproveError}>
                                  <input
                                    id="new-identity"
                                    aria-describedby={fieldDescribedBy('new-identity', { error: inlineApproveError })}
                                    type="text"
                                    value={newMqttIdentity}
                                    onChange={(e) => {
                                      setNewMqttIdentity(e.target.value);
                                      setInlineApproveError(null);
                                    }}
                                    placeholder="Tên máy (mqtt_identity)"
                                    aria-label="Tên máy"
                                    disabled={inFlight}
                                    className={`w-full font-mono ${inputClass}`}
                                  />
                                </Field>
                                <Field htmlFor="new-zone" label="Zone">
                                  <select
                                    id="new-zone"
                                    value={newZoneId}
                                    onChange={(e) => setNewZoneId(e.target.value)}
                                    aria-label="Zone"
                                    disabled={inFlight}
                                    className={`w-full ${selectClass}`}
                                  >
                                    <option value="">— Không thuộc zone —</option>
                                    {zones?.map((z) => (
                                      <option key={z.id} value={z.id}>
                                        {z.name}
                                      </option>
                                    ))}
                                  </select>
                                </Field>
                                <div className="flex items-center space-x-2">
                                  <Button
                                    variant="primary"
                                    type="button"
                                    disabled={inFlight}
                                    onClick={() => handleSubmitInlineApprove(req.id)}
                                  >
                                    Xác nhận
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    type="button"
                                    disabled={inFlight}
                                    onClick={handleCancelInlineApprove}
                                  >
                                    Hủy
                                  </Button>
                                </div>
                              </div>
                            </TD>
                          </TR>
                        )}
                      </React.Fragment>
                    );
                  })
                ) : (
                  <EmptyRow colSpan={7}>
                    Không có yêu cầu nào
                  </EmptyRow>
                )}
              </tbody>
            </Table>
          ) : (
            /* Approved / Rejected Read-only table */
            <Table>
              <THead>
                <TR>
                  <TH className="text-left">Hostname</TH>
                  <TH className="text-left">MAC</TH>
                  <TH className="text-left">
                    {status === 'approved' ? 'Duyệt lúc' : 'Từ chối lúc'}
                  </TH>
                  <TH className="text-left">Máy</TH>
                </TR>
              </THead>
              <tbody>
                {requests && requests.length > 0 ? (
                  requests.map((req) => (
                    <TR key={req.id} className="hover:bg-canvas">
                      <TD className="font-medium text-ink">{req.hostname}</TD>
                      <TD className="font-mono text-ink">{req.mac_address}</TD>
                      <TD className="text-ink-muted">
                        {formatDateTime(req.reviewed_at)}
                      </TD>
                      <TD>
                        {req.workstation ? (
                          <Link
                            to={`/workstations/${req.workstation.id}`}
                            className="text-accent hover:underline font-mono"
                          >
                            {req.workstation.mqtt_identity}
                          </Link>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </TD>
                    </TR>
                  ))
                ) : (
                  <EmptyRow colSpan={4}>
                    Không có yêu cầu nào
                  </EmptyRow>
                )}
              </tbody>
            </Table>
          )}
        </>
      )}
      <ConfirmDialog
        open={reinstallTarget !== null}
        title={`Duyệt cài lại máy ${reinstallTarget?.duplicate_of?.mqtt_identity ?? ''}?`}
        message={`Duyệt cài lại máy ${reinstallTarget?.duplicate_of?.mqtt_identity ?? ''}? Chứng chỉ cũ bị thu hồi; máy giữ tên, zone và lịch.`}
        confirmLabel="Duyệt cài lại"
        tone="danger"
        onCancel={() => setReinstallTarget(null)}
        onConfirm={async () => { if (reinstallTarget) await handleApproveReinstall(reinstallTarget); }}
      />
      <ConfirmDialog
        open={rejectTarget !== null}
        title={`Từ chối yêu cầu ${rejectTarget?.hostname ?? ''}?`}
        message="Yêu cầu sẽ bị từ chối. Lý do từ chối (không bắt buộc):"
        input={{ label: 'Lý do từ chối (không bắt buộc):' }}
        confirmLabel="Từ chối"
        tone="danger"
        onCancel={() => setRejectTarget(null)}
        onConfirm={async (note) => { if (rejectTarget) await handleReject(rejectTarget.id, note ?? ''); }}
      />
    </div>
  );
}
