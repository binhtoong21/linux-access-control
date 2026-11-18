import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createSchedule,
  getSchedule,
  listGroups,
  listWorkstations,
  listZones,
  updateSchedule,
  validateSchedule,
} from '../api/endpoints';
import type { DayOfWeek, Schedule, ScheduleInput } from '../api/types';
import { ApiError } from '../api/client';
import { DAYS, isValidOsUsername, isValidTime, todayLocal } from '../lib/schedule';
import { errorMessage } from '../lib/errors';
import { UserPicker } from '../components/UserPicker';

interface ScheduleFormProps {
  initialSchedule?: Schedule;
  scheduleId?: string;
}

function ScheduleForm({ initialSchedule, scheduleId }: ScheduleFormProps) {
  const isEdit = Boolean(scheduleId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState(initialSchedule?.name ?? '');

  const [subjectType, setSubjectType] = useState<'group' | 'user'>(
    initialSchedule?.subject.type ?? 'group',
  );
  const [subjectId, setSubjectId] = useState(initialSchedule?.subject.id ?? '');
  const [subjectName, setSubjectName] = useState(initialSchedule?.subject.name ?? '');
  const [subjectExternalId, setSubjectExternalId] = useState(
    initialSchedule?.subject.external_id ?? '',
  );

  const [targetType, setTargetType] = useState<'zone' | 'workstation'>(
    initialSchedule?.target.type ?? 'zone',
  );
  const [targetId, setTargetId] = useState(initialSchedule?.target.id ?? '');

  const [daysOfWeek, setDaysOfWeek] = useState<DayOfWeek[]>(
    initialSchedule?.days_of_week ?? [],
  );

  const [startTime, setStartTime] = useState(initialSchedule?.start_time ?? '');
  const [endTime, setEndTime] = useState(initialSchedule?.end_time ?? '');

  const [validFrom, setValidFrom] = useState(
    initialSchedule?.valid_from ?? todayLocal(),
  );
  const [validTo, setValidTo] = useState(initialSchedule?.valid_to ?? '');

  const [targetOsUsername, setTargetOsUsername] = useState(
    initialSchedule?.target_os_username ?? '',
  );

  const [isSaving, setIsSaving] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [saveFieldErrors, setSaveFieldErrors] = useState<Record<string, string[]>>({});
  const inFlightRef = useRef(false);

  // Aux queries
  const { data: groups } = useQuery({
    queryKey: ['groups'],
    queryFn: listGroups,
  });

  const { data: zones } = useQuery({
    queryKey: ['zones'],
    queryFn: listZones,
  });

  const { data: workstations } = useQuery({
    queryKey: ['workstations'],
    queryFn: () => listWorkstations(),
  });

  // Local Validation
  const localErrors: {
    name?: string;
    subject?: string;
    target?: string;
    days_of_week?: string;
    start_time?: string;
    end_time?: string;
    valid_to?: string;
    target_os_username?: string;
  } = {};

  if (!name.trim()) {
    localErrors.name = 'Tên không được để trống';
  }

  if (!subjectId) {
    localErrors.subject = 'Vui lòng chọn đối tượng';
  }

  if (!targetId) {
    localErrors.target = 'Vui lòng chọn phạm vi áp dụng';
  }

  if (daysOfWeek.length === 0) {
    localErrors.days_of_week = 'Chọn ít nhất một ngày trong tuần';
  }

  if (!startTime.trim()) {
    localErrors.start_time = 'Giờ bắt đầu không được để trống';
  } else if (!isValidTime(startTime.trim())) {
    localErrors.start_time = 'Giờ bắt đầu không hợp lệ (HH:MM)';
  }

  if (!endTime.trim()) {
    localErrors.end_time = 'Giờ kết thúc không được để trống';
  } else if (!isValidTime(endTime.trim())) {
    localErrors.end_time = 'Giờ kết thúc không hợp lệ (HH:MM hoặc 24:00)';
  }

  if (
    isValidTime(startTime.trim()) &&
    isValidTime(endTime.trim()) &&
    startTime.trim() >= endTime.trim()
  ) {
    localErrors.end_time = 'Giờ kết thúc phải sau giờ bắt đầu';
  }

  if (validTo && validFrom && validTo < validFrom) {
    localErrors.valid_to = 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu';
  }

  if (targetOsUsername.trim() && !isValidOsUsername(targetOsUsername.trim())) {
    localErrors.target_os_username =
      'Profile chỉ gồm chữ thường, số, gạch dưới, gạch ngang (bắt đầu bằng chữ hoặc gạch dưới, tối đa 32 ký tự)';
  }

  const isLocallyValid = Object.keys(localErrors).length === 0;

  const currentInput: ScheduleInput | null = isLocallyValid
    ? {
        name: name.trim(),
        subject: {
          type: subjectType,
          id: subjectId,
        },
        target: {
          type: targetType,
          id: targetId,
        },
        valid_from: validFrom,
        valid_to: validTo ? validTo : null,
        days_of_week: daysOfWeek,
        start_time: startTime.trim(),
        end_time: endTime.trim(),
        target_os_username: targetOsUsername.trim() ? targetOsUsername.trim() : null,
      }
    : null;

  // 500 ms debounce for live validation
  const [debouncedInput, setDebouncedInput] = useState<ScheduleInput | null>(null);
  const [isDebouncing, setIsDebouncing] = useState(false);

  useEffect(() => {
    if (!currentInput) {
      setDebouncedInput(null);
      setIsDebouncing(false);
      return;
    }

    setIsDebouncing(true);
    const timer = setTimeout(() => {
      setDebouncedInput(currentInput);
      setIsDebouncing(false);
    }, 500);

    return () => {
      clearTimeout(timer);
    };
  }, [
    isLocallyValid,
    name,
    subjectType,
    subjectId,
    targetType,
    targetId,
    validFrom,
    validTo,
    daysOfWeek.join(','),
    startTime,
    endTime,
    targetOsUsername,
  ]);

  const inputJson = debouncedInput ? JSON.stringify(debouncedInput) : null;
  const {
    data: validationResult,
    isLoading: isValidating,
    isFetching,
    isError: checkFailed,
    error: checkError,
    refetch: retryCheck,
  } = useQuery({
    queryKey: ['schedules', 'validate', scheduleId ?? 'new', inputJson],
    queryFn: () =>
      validateSchedule({
        ...debouncedInput!,
        ...(scheduleId ? { schedule_id: scheduleId } : {}),
      }),
    enabled: Boolean(debouncedInput),
  });

  const liveFieldErrors: Record<string, string[]> = {};
  if (validationResult?.errors) {
    for (const err of validationResult.errors) {
      liveFieldErrors[err.field] = [
        ...(liveFieldErrors[err.field] ?? []),
        ...err.constraints,
      ];
    }
  }

  const checkPending =
    isDebouncing || isValidating || isFetching || (isLocallyValid && debouncedInput === null);

  // Saving needs a successful check of exactly what is in the form now: a failed or stale check could hide a warning.
  const checkOk =
    !checkPending &&
    !checkFailed &&
    validationResult !== undefined &&
    currentInput !== null &&
    inputJson === JSON.stringify(currentInput);

  const isSaveDisabled =
    !isLocallyValid ||
    !checkOk ||
    (validationResult?.errors && validationResult.errors.length > 0) ||
    isSaving;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlightRef.current || isSaving) return;
    if (!isLocallyValid || !currentInput) return;
    if (!checkOk) return;
    if (validationResult?.errors && validationResult.errors.length > 0) return;

    if (validationResult?.warnings && validationResult.warnings.length > 0) {
      const ok = window.confirm('Lịch có cảnh báo (xem bên dưới). Vẫn lưu?');
      if (!ok) return;
    }

    inFlightRef.current = true;
    setIsSaving(true);
    setPageError(null);
    setSaveFieldErrors({});

    try {
      if (isEdit && scheduleId) {
        await updateSchedule(scheduleId, currentInput);
      } else {
        await createSchedule(currentInput);
      }
      await queryClient.invalidateQueries({ queryKey: ['schedules'] });
      navigate('/schedules');
    } catch (err) {
      setPageError(errorMessage(err));
      if (err instanceof ApiError && Array.isArray(err.details)) {
        const fieldErrors: Record<string, string[]> = {};
        for (const item of err.details) {
          if (item && typeof item.field === 'string' && Array.isArray(item.constraints)) {
            fieldErrors[item.field] = item.constraints;
          }
        }
        setSaveFieldErrors(fieldErrors);
      }
    } finally {
      setIsSaving(false);
      inFlightRef.current = false;
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <Link to="/schedules" className="text-sm text-blue-600 hover:underline">
          ← Danh sách lịch
        </Link>
        <h1 className="text-xl font-bold text-gray-900 mt-2">
          {isEdit ? 'Sửa lịch' : 'Thêm lịch mới'}
        </h1>
      </div>

      {pageError && (
        <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200 text-sm">
          {pageError}
        </div>
      )}

      <form onSubmit={handleSave} className="bg-white p-6 rounded-lg shadow space-y-6">
        {/* Name */}
        <div>
          <label htmlFor="schedule-name" className="block text-sm font-medium text-gray-700">
            Tên *
          </label>
          <input
            id="schedule-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ví dụ: Ca sáng môn Mạng máy tính"
            className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {localErrors.name && (
            <div className="text-xs text-red-600 mt-1">{localErrors.name}</div>
          )}
          {liveFieldErrors['name']?.map((msg, i) => (
            <div key={i} className="text-xs text-red-600 mt-1">
              {msg}
            </div>
          ))}
          {saveFieldErrors['name']?.map((msg, i) => (
            <div key={i} className="text-xs text-red-600 mt-1">
              {msg}
            </div>
          ))}
        </div>

        {/* Ai (Subject) */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">Ai *</label>
          <div className="flex items-center space-x-4">
            <label className="inline-flex items-center space-x-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="subjectType"
                value="group"
                checked={subjectType === 'group'}
                onChange={() => {
                  setSubjectType('group');
                  setSubjectId('');
                  setSubjectName('');
                  setSubjectExternalId('');
                }}
                className="text-blue-600 focus:ring-blue-500"
              />
              <span>Nhóm</span>
            </label>
            <label className="inline-flex items-center space-x-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="subjectType"
                value="user"
                checked={subjectType === 'user'}
                onChange={() => {
                  setSubjectType('user');
                  setSubjectId('');
                  setSubjectName('');
                  setSubjectExternalId('');
                }}
                className="text-blue-600 focus:ring-blue-500"
              />
              <span>Người dùng</span>
            </label>
          </div>

          {subjectType === 'group' && (
            <div>
              <select
                aria-label="Chọn nhóm"
                value={subjectId}
                onChange={(e) => {
                  const gId = e.target.value;
                  setSubjectId(gId);
                  const found = groups?.find((g) => g.id === gId);
                  setSubjectName(found?.name ?? '');
                }}
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

          {subjectType === 'user' && (
            <div>
              {subjectId ? (
                <div className="flex items-center space-x-2 border border-gray-300 rounded px-3 py-1.5 bg-gray-50">
                  <span className="text-sm text-gray-900 font-medium">
                    {subjectExternalId ? `${subjectExternalId} — ` : ''}
                    {subjectName}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSubjectId('');
                      setSubjectName('');
                      setSubjectExternalId('');
                    }}
                    className="text-xs text-blue-600 hover:underline font-medium"
                  >
                    Đổi
                  </button>
                </div>
              ) : (
                <UserPicker
                  onPick={(u) => {
                    setSubjectId(u.id);
                    setSubjectName(u.full_name);
                    setSubjectExternalId(u.external_id);
                  }}
                  placeholder="Tìm người dùng..."
                />
              )}
            </div>
          )}
          {localErrors.subject && (
            <div className="text-xs text-red-600 mt-1">{localErrors.subject}</div>
          )}
          {liveFieldErrors['subject']?.map((msg, i) => (
            <div key={i} className="text-xs text-red-600 mt-1">
              {msg}
            </div>
          ))}
          {saveFieldErrors['subject']?.map((msg, i) => (
            <div key={i} className="text-xs text-red-600 mt-1">
              {msg}
            </div>
          ))}
        </div>

        {/* Ở đâu (Target) */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">Ở đâu *</label>
          <div className="flex items-center space-x-4">
            <label className="inline-flex items-center space-x-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="targetType"
                value="zone"
                checked={targetType === 'zone'}
                onChange={() => {
                  setTargetType('zone');
                  setTargetId('');
                }}
                className="text-blue-600 focus:ring-blue-500"
              />
              <span>Zone</span>
            </label>
            <label className="inline-flex items-center space-x-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="targetType"
                value="workstation"
                checked={targetType === 'workstation'}
                onChange={() => {
                  setTargetType('workstation');
                  setTargetId('');
                }}
                className="text-blue-600 focus:ring-blue-500"
              />
              <span>Máy</span>
            </label>
          </div>

          {targetType === 'zone' && (
            <div>
              <select
                aria-label="Chọn zone"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- Chọn zone --</option>
                {zones?.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {targetType === 'workstation' && (
            <div>
              <select
                aria-label="Chọn máy"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- Chọn máy --</option>
                {workstations?.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.mqtt_identity} ({ws.hostname})
                  </option>
                ))}
              </select>
            </div>
          )}
          {localErrors.target && (
            <div className="text-xs text-red-600 mt-1">{localErrors.target}</div>
          )}
          {liveFieldErrors['target']?.map((msg, i) => (
            <div key={i} className="text-xs text-red-600 mt-1">
              {msg}
            </div>
          ))}
          {saveFieldErrors['target']?.map((msg, i) => (
            <div key={i} className="text-xs text-red-600 mt-1">
              {msg}
            </div>
          ))}
        </div>

        {/* Ngày */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">Ngày *</label>
          <div className="flex flex-wrap gap-3 items-center">
            {DAYS.map(({ day, label }) => {
              const checked = daysOfWeek.includes(day);
              return (
                <label key={day} className="inline-flex items-center space-x-1.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setDaysOfWeek((prev) => [...prev, day]);
                      } else {
                        setDaysOfWeek((prev) => prev.filter((d) => d !== day));
                      }
                    }}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>{label}</span>
                </label>
              );
            })}
            <div className="flex items-center space-x-2 ml-2">
              <button
                type="button"
                onClick={() =>
                  setDaysOfWeek(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'])
                }
                className="text-xs px-2.5 py-1 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded border border-gray-300 font-medium"
              >
                T2–T6
              </button>
              <button
                type="button"
                onClick={() =>
                  setDaysOfWeek([
                    'MONDAY',
                    'TUESDAY',
                    'WEDNESDAY',
                    'THURSDAY',
                    'FRIDAY',
                    'SATURDAY',
                    'SUNDAY',
                  ])
                }
                className="text-xs px-2.5 py-1 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded border border-gray-300 font-medium"
              >
                Hằng ngày
              </button>
            </div>
          </div>
          {localErrors.days_of_week && (
            <div className="text-xs text-red-600 mt-1">{localErrors.days_of_week}</div>
          )}
          {liveFieldErrors['days_of_week']?.map((msg, i) => (
            <div key={i} className="text-xs text-red-600 mt-1">
              {msg}
            </div>
          ))}
          {saveFieldErrors['days_of_week']?.map((msg, i) => (
            <div key={i} className="text-xs text-red-600 mt-1">
              {msg}
            </div>
          ))}
        </div>

        {/* Giờ bắt đầu / kết thúc */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="schedule-start-time" className="block text-sm font-medium text-gray-700">
              Giờ bắt đầu *
            </label>
            <input
              id="schedule-start-time"
              type="text"
              placeholder="07:30"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {localErrors.start_time && (
              <div className="text-xs text-red-600 mt-1">{localErrors.start_time}</div>
            )}
            {liveFieldErrors['start_time']?.map((msg, i) => (
              <div key={i} className="text-xs text-red-600 mt-1">
                {msg}
              </div>
            ))}
            {saveFieldErrors['start_time']?.map((msg, i) => (
              <div key={i} className="text-xs text-red-600 mt-1">
                {msg}
              </div>
            ))}
          </div>
          <div>
            <label htmlFor="schedule-end-time" className="block text-sm font-medium text-gray-700">
              Giờ kết thúc *
            </label>
            <input
              id="schedule-end-time"
              type="text"
              placeholder="07:30"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {localErrors.end_time && (
              <div className="text-xs text-red-600 mt-1">{localErrors.end_time}</div>
            )}
            {liveFieldErrors['end_time']?.map((msg, i) => (
              <div key={i} className="text-xs text-red-600 mt-1">
                {msg}
              </div>
            ))}
            {saveFieldErrors['end_time']?.map((msg, i) => (
              <div key={i} className="text-xs text-red-600 mt-1">
                {msg}
              </div>
            ))}
          </div>
        </div>

        {/* Hiệu lực từ / đến */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="schedule-valid-from" className="block text-sm font-medium text-gray-700">
              Hiệu lực từ *
            </label>
            <input
              id="schedule-valid-from"
              type="date"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {liveFieldErrors['valid_from']?.map((msg, i) => (
              <div key={i} className="text-xs text-red-600 mt-1">
                {msg}
              </div>
            ))}
            {saveFieldErrors['valid_from']?.map((msg, i) => (
              <div key={i} className="text-xs text-red-600 mt-1">
                {msg}
              </div>
            ))}
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="schedule-valid-to" className="block text-sm font-medium text-gray-700">
                Hiệu lực đến
              </label>
              <button
                type="button"
                onClick={() => setValidTo('')}
                className="text-xs text-blue-600 hover:underline"
              >
                Không giới hạn
              </button>
            </div>
            <input
              id="schedule-valid-to"
              type="date"
              value={validTo}
              onChange={(e) => setValidTo(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {localErrors.valid_to && (
              <div className="text-xs text-red-600 mt-1">{localErrors.valid_to}</div>
            )}
            {liveFieldErrors['valid_to']?.map((msg, i) => (
              <div key={i} className="text-xs text-red-600 mt-1">
                {msg}
              </div>
            ))}
            {saveFieldErrors['valid_to']?.map((msg, i) => (
              <div key={i} className="text-xs text-red-600 mt-1">
                {msg}
              </div>
            ))}
          </div>
        </div>

        {/* Profile */}
        <div>
          <label htmlFor="schedule-profile" className="block text-sm font-medium text-gray-700">
            Profile
          </label>
          <input
            id="schedule-profile"
            type="text"
            placeholder="để trống = profile mặc định của máy"
            value={targetOsUsername}
            onChange={(e) => setTargetOsUsername(e.target.value)}
            className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {localErrors.target_os_username && (
            <div className="text-xs text-red-600 mt-1">{localErrors.target_os_username}</div>
          )}
          {liveFieldErrors['target_os_username']?.map((msg, i) => (
            <div key={i} className="text-xs text-red-600 mt-1">
              {msg}
            </div>
          ))}
          {saveFieldErrors['target_os_username']?.map((msg, i) => (
            <div key={i} className="text-xs text-red-600 mt-1">
              {msg}
            </div>
          ))}
        </div>

        {/* Warnings Section */}
        {checkFailed && !checkPending && (
          <div className="mb-4 p-3 rounded border border-red-200 bg-red-50 text-sm text-red-700 flex items-center justify-between">
            <span>Không kiểm tra được lịch: {errorMessage(checkError)}. Chưa thể lưu.</span>
            <button
              type="button"
              onClick={() => void retryCheck()}
              className="ml-3 px-2 py-1 text-xs border border-red-300 rounded hover:bg-red-100"
            >
              Thử lại
            </button>
          </div>
        )}
        {validationResult?.warnings && validationResult.warnings.length > 0 && (
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-900 space-y-2">
            <div className="font-semibold text-sm">Cảnh báo:</div>
            {validationResult.warnings.map((w, index) => {
              if (w.code === 'ambiguous_profile') {
                return (
                  <div key={index} className="text-sm">
                    Trùng giờ với lịch "{w.schedule?.name}" cho cùng người nhưng khác profile: ở các
                    máy{' '}
                    {w.workstations.map((ws, i) => (
                      <React.Fragment key={ws.id}>
                        {i > 0 && ', '}
                        <Link
                          to={`/workstations/${ws.id}`}
                          className="font-medium underline hover:text-blue-800"
                        >
                          {ws.mqtt_identity}
                        </Link>
                      </React.Fragment>
                    ))}{' '}
                    lần quẹt sẽ bị từ chối (ambiguous_profile).
                  </div>
                );
              }

              if (w.code === 'missing_profile') {
                return (
                  <div key={index} className="text-sm">
                    Các máy{' '}
                    {w.workstations.map((ws, i) => (
                      <React.Fragment key={ws.id}>
                        {i > 0 && ', '}
                        <Link
                          to={`/workstations/${ws.id}`}
                          className="font-medium underline hover:text-blue-800"
                        >
                          {ws.mqtt_identity}
                        </Link>
                      </React.Fragment>
                    ))}{' '}
                    chưa có profile {w.target_os_username ?? 'mặc định'} đang bật: người dùng sẽ bị
                    từ chối ở đó. Bật profile ở trang chi tiết máy.
                  </div>
                );
              }

              return (
                <div key={index} className="text-sm">
                  {w.message}
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom Actions */}
        <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={() => navigate('/schedules')}
            className="px-4 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-100"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={isSaveDisabled}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function ScheduleFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);

  const {
    data: schedule,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['schedules', id],
    queryFn: () => getSchedule(id!),
    enabled: isEdit,
  });

  if (isEdit && isLoading) {
    return <div className="p-8 text-center text-gray-500">Đang tải…</div>;
  }

  if (isEdit && isError) {
    return (
      <div className="space-y-4">
        <Link to="/schedules" className="text-sm text-blue-600 hover:underline">
          ← Danh sách lịch
        </Link>
        <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200">
          {errorMessage(error)}
        </div>
      </div>
    );
  }

  return <ScheduleForm initialSchedule={schedule} scheduleId={id} />;
}
