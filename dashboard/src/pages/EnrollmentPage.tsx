import React, { useRef, useState, useEffect } from 'react';
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
    const confirmed = window.confirm(
      `Duyệt cài lại máy ${req.duplicate_of.mqtt_identity}? Chứng chỉ cũ bị thu hồi; máy giữ tên, zone và lịch.`,
    );
    if (!confirmed) return;

    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setInFlight(true);
    setPageError(null);

    try {
      await approveEnrollmentReinstall(req.id);
      await queryClient.invalidateQueries({ queryKey: ['enrollment'] });
      await queryClient.invalidateQueries({ queryKey: ['workstations'] });
    } catch (err) {
      setPageError(errorMessage(err));
    } finally {
      inFlightRef.current = false;
      setInFlight(false);
    }
  };

  const handleReject = async (id: string) => {
    const note = window.prompt('Lý do từ chối (không bắt buộc):');
    if (note === null) return; // user cancelled, sends nothing

    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setInFlight(true);
    setPageError(null);

    try {
      await rejectEnrollment(id, note.trim() || undefined);
      await queryClient.invalidateQueries({ queryKey: ['enrollment'] });
      await queryClient.invalidateQueries({ queryKey: ['workstations'] });
    } catch (err) {
      setPageError(errorMessage(err));
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl font-bold text-gray-900">Duyệt máy</h1>
      </div>

      {pageError && (
        <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200">
          {pageError}
        </div>
      )}

      {/* Status tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            type="button"
            onClick={() => handleTabChange('pending')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              status === 'pending'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Đang chờ
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('approved')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              status === 'approved'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Đã duyệt
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('rejected')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              status === 'rejected'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Đã từ chối
          </button>
        </nav>
      </div>

      {/* Batch Bar (only on pending when >= 1 row checked) */}
      {status === 'pending' && checkedIds.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <span className="font-semibold text-sm text-blue-900">
              Đã chọn {checkedIds.length} máy
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="batch-zone" className="block text-xs font-medium text-gray-700 mb-1">
                Zone *
              </label>
              <select
                id="batch-zone"
                value={batchZoneId}
                onChange={(e) => setBatchZoneId(e.target.value)}
                disabled={inFlight}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {zones?.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="batch-prefix" className="block text-xs font-medium text-gray-700 mb-1">
                Tiền tố tên *
              </label>
              <input
                id="batch-prefix"
                type="text"
                value={namePrefix}
                onChange={(e) => {
                  setNamePrefix(e.target.value);
                  setBatchError(null);
                }}
                placeholder="Ví dụ: lab-pc-"
                disabled={inFlight}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <p className="text-xs text-gray-600">
            Tên máy sẽ là {namePrefix || '{prefix}'}NN, nối tiếp số lớn nhất đã dùng.
          </p>

          {batchError && <div className="text-xs text-red-600">{batchError}</div>}

          <div className="flex justify-end">
            <button
              type="button"
              disabled={inFlight || !batchZoneId}
              onClick={handleApproveBatch}
              className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Duyệt {checkedIds.length} máy
            </button>
          </div>
        </div>
      )}

      {/* Batch Results Banner */}
      {batchResult && (
        <div className="bg-white border border-gray-300 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900">Kết quả duyệt hàng loạt</h2>
            <button
              type="button"
              onClick={() => setBatchResult(null)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Đóng
            </button>
          </div>
          {batchResult.approved.length > 0 && (
            <div>
              <span className="text-xs font-semibold text-green-700">Đã duyệt: </span>
              <span className="text-xs text-gray-800">
                {batchResult.approved.map((item) => item.mqtt_identity).join(', ')}
              </span>
            </div>
          )}
          {batchResult.skipped.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-semibold text-amber-700">Bỏ qua:</span>
              <ul className="text-xs text-gray-700 list-disc list-inside">
                {batchResult.skipped.map((item) => (
                  <li key={item.id}>
                    Yêu cầu {item.id}: {formatBatchSkipReason(item.reason)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {isLoading && <div className="p-8 text-center text-gray-500">Đang tải…</div>}

      {isError && (
        <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200">
          {errorMessage(error)}
        </div>
      )}

      {!isLoading && !isError && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            {status === 'pending' ? (
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-gray-600 font-medium">
                  <tr>
                    <th className="w-10 px-4 py-3 text-center"></th>
                    <th className="px-4 py-3 text-left">Hostname</th>
                    <th className="px-4 py-3 text-left">MAC</th>
                    <th className="px-4 py-3 text-left">Machine ID</th>
                    <th className="px-4 py-3 text-left">Gửi lúc</th>
                    <th className="px-4 py-3 text-left">Trùng</th>
                    <th className="px-4 py-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {requests && requests.length > 0 ? (
                    requests.map((req) => {
                      const isRowApproving = approvingRowId === req.id;
                      const hasDuplicateMac = req.duplicate_mac_detected;
                      const isReinstall = Boolean(req.duplicate_of);
                      const isDuplicateOther = hasDuplicateMac && !isReinstall;

                      return (
                        <React.Fragment key={req.id}>
                          <tr className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-center">
                              {!hasDuplicateMac && (
                                <input
                                  type="checkbox"
                                  checked={checkedIds.includes(req.id)}
                                  onChange={() => handleToggleCheck(req.id)}
                                  aria-label={`Chọn ${req.hostname}`}
                                  disabled={inFlight}
                                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                />
                              )}
                            </td>
                            <td className="px-4 py-3 font-medium text-gray-900">{req.hostname}</td>
                            <td className="px-4 py-3 font-mono text-gray-700">{req.mac_address}</td>
                            <td className="px-4 py-3">
                              <span title={req.machine_id} className="font-mono text-xs text-gray-600">
                                {req.machine_id.length > 12
                                  ? `${req.machine_id.slice(0, 12)}…`
                                  : req.machine_id}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {formatDateTime(req.submitted_at)}
                            </td>
                            <td className="px-4 py-3 text-xs">
                              {isReinstall && req.duplicate_of && (
                                <span className="text-amber-700 font-medium">
                                  Trùng máy {req.duplicate_of.mqtt_identity}
                                </span>
                              )}
                              {isDuplicateOther && (
                                <span className="text-amber-700 font-medium">
                                  Trùng yêu cầu khác đang chờ
                                </span>
                              )}
                              {!hasDuplicateMac && !isReinstall && (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right space-x-2">
                              {!hasDuplicateMac && !isReinstall && !isRowApproving && (
                                <button
                                  type="button"
                                  disabled={inFlight}
                                  onClick={() => handleOpenInlineApprove(req)}
                                  className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                                >
                                  Duyệt
                                </button>
                              )}
                              {isReinstall && req.duplicate_of && (
                                <button
                                  type="button"
                                  disabled={inFlight}
                                  onClick={() => handleApproveReinstall(req)}
                                  className="text-xs px-2.5 py-1 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
                                >
                                  Duyệt cài lại {req.duplicate_of.mqtt_identity}
                                </button>
                              )}
                              {isDuplicateOther && (
                                <span className="text-xs text-gray-500 mr-2">
                                  Duyệt yêu cầu kia trước; yêu cầu này sẽ thành cài lại.
                                </span>
                              )}
                              {!isRowApproving && (
                                <button
                                  type="button"
                                  disabled={inFlight}
                                  onClick={() => handleReject(req.id)}
                                  className="text-xs px-2.5 py-1 border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
                                >
                                  Từ chối
                                </button>
                              )}
                            </td>
                          </tr>

                          {/* Inline Approve Form Row */}
                          {isRowApproving && (
                            <tr className="bg-blue-50/50">
                              <td colSpan={7} className="px-4 py-3">
                                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                  <div className="flex-1">
                                    <label htmlFor="new-identity" className="sr-only">
                                      Tên máy
                                    </label>
                                    <input
                                      id="new-identity"
                                      type="text"
                                      value={newMqttIdentity}
                                      onChange={(e) => {
                                        setNewMqttIdentity(e.target.value);
                                        setInlineApproveError(null);
                                      }}
                                      placeholder="Tên máy (mqtt_identity)"
                                      aria-label="Tên máy"
                                      disabled={inFlight}
                                      className="w-full border border-gray-300 rounded px-2.5 py-1 text-sm bg-white"
                                    />
                                  </div>
                                  <div className="w-48">
                                    <label htmlFor="new-zone" className="sr-only">
                                      Zone
                                    </label>
                                    <select
                                      id="new-zone"
                                      value={newZoneId}
                                      onChange={(e) => setNewZoneId(e.target.value)}
                                      aria-label="Zone"
                                      disabled={inFlight}
                                      className="w-full border border-gray-300 rounded px-2.5 py-1 text-sm bg-white"
                                    >
                                      <option value="">— Không thuộc zone —</option>
                                      {zones?.map((z) => (
                                        <option key={z.id} value={z.id}>
                                          {z.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <button
                                      type="button"
                                      disabled={inFlight}
                                      onClick={() => handleSubmitInlineApprove(req.id)}
                                      className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                                    >
                                      Xác nhận
                                    </button>
                                    <button
                                      type="button"
                                      disabled={inFlight}
                                      onClick={handleCancelInlineApprove}
                                      className="px-3 py-1 border border-gray-300 text-gray-700 rounded text-xs hover:bg-gray-50 disabled:opacity-50"
                                    >
                                      Hủy
                                    </button>
                                  </div>
                                </div>
                                {inlineApproveError && (
                                  <div className="text-xs text-red-600 mt-2">
                                    {inlineApproveError}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                        Không có yêu cầu nào
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              /* Approved / Rejected Read-only table */
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-gray-600 font-medium">
                  <tr>
                    <th className="px-4 py-3 text-left">Hostname</th>
                    <th className="px-4 py-3 text-left">MAC</th>
                    <th className="px-4 py-3 text-left">
                      {status === 'approved' ? 'Duyệt lúc' : 'Từ chối lúc'}
                    </th>
                    <th className="px-4 py-3 text-left">Máy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {requests && requests.length > 0 ? (
                    requests.map((req) => (
                      <tr key={req.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{req.hostname}</td>
                        <td className="px-4 py-3 font-mono text-gray-700">{req.mac_address}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {formatDateTime(req.reviewed_at)}
                        </td>
                        <td className="px-4 py-3">
                          {req.workstation ? (
                            <Link
                              to={`/workstations/${req.workstation.id}`}
                              className="text-blue-600 hover:underline font-mono"
                            >
                              {req.workstation.mqtt_identity}
                            </Link>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                        Không có yêu cầu nào
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
