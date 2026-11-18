import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  ConfirmDialog,
  Field,
  fieldDescribedBy,
  inputClass,
  selectClass,
  Notice,
  PageHeader,
} from '../components/ui';
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
  const [warningInput, setWarningInput] = useState<string | null>(null);

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

  useEffect(() => {
    if (warningInput !== null && warningInput !== JSON.stringify(currentInput)) {
      setWarningInput(null);
    }
  }, [warningInput, JSON.stringify(currentInput)]);

  const executeSave = async (confirmed = false) => {
    if (inFlightRef.current || isSaving || !currentInput || !checkOk || isSaveDisabled) return;
    if (confirmed && warningInput !== JSON.stringify(currentInput)) {
      setWarningInput(null);
      return;
    }
    if (!confirmed && validationResult?.warnings.length) {
      setWarningInput(JSON.stringify(currentInput));
      return;
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
      setWarningInput(null);
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
      if (confirmed) throw err;
    } finally {
      setIsSaving(false);
      inFlightRef.current = false;
    }
  };

  const fieldError = (field: string) => {
    const local: Record<string, string | undefined> = localErrors;
    return [local[field], ...(liveFieldErrors[field] ?? []), ...(saveFieldErrors[field] ?? [])]
      .filter(Boolean).join(' ');
  };
  const describedBy = (id: string, field: string) => fieldDescribedBy(id, { error: fieldError(field) });

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Link to="/schedules" className="text-sm text-accent hover:underline">← Danh sách lịch</Link>
      <PageHeader title={isEdit ? 'Sửa lịch' : 'Thêm lịch mới'} />
      {pageError && warningInput === null && <Notice tone="danger">{pageError}</Notice>}
      <form
        onSubmit={(e) => { e.preventDefault(); void executeSave(); }}
        className="bg-surface border border-line p-6 rounded space-y-6"
      >
        <Field htmlFor="schedule-name" label="Tên *" error={fieldError('name')}>
          <input
            id="schedule-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ví dụ: Ca sáng môn Mạng máy tính"
            aria-describedby={describedBy('schedule-name', 'name')}
            className={`w-full ${inputClass}`}
          />
        </Field>
        <fieldset className="space-y-2" aria-describedby={describedBy('schedule-subject', 'subject')}>
          <legend className="text-sm font-medium text-ink">Ai *</legend>
          <div className="flex items-center gap-4">
            {(['group', 'user'] as const).map((type) => (
              <label key={type} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="subjectType"
                  value={type}
                  checked={subjectType === type}
                  onChange={() => { setSubjectType(type); setSubjectId(''); setSubjectName(''); setSubjectExternalId(''); }}
                  className="h-4 w-4 rounded border-control accent-accent focus:ring-accent"
                />
                {type === 'group' ? 'Nhóm' : 'Người dùng'}
              </label>
            ))}
          </div>
          <Field
            htmlFor="schedule-subject"
            label={subjectType === 'group' ? 'Chọn nhóm' : 'Chọn người dùng'}
            error={fieldError('subject')}
          >
            {subjectType === 'group' ? (
              <select
                id="schedule-subject"
                value={subjectId}
                onChange={(e) => {
                  setSubjectId(e.target.value); setSubjectName(groups?.find((g) => g.id === e.target.value)?.name ?? '');
                }}
                aria-describedby={describedBy('schedule-subject', 'subject')}
                className={`w-full ${selectClass}`}
              >
                <option value="">-- Chọn nhóm --</option>
                {groups?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            ) : subjectId ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink">{subjectExternalId ? `${subjectExternalId} — ` : ''}{subjectName}</span>
                <Button
                  variant="quiet"
                  onClick={() => { setSubjectId(''); setSubjectName(''); setSubjectExternalId(''); }}
                >Đổi</Button>
              </div>
            ) : <div id="schedule-subject"><UserPicker
              onPick={(u) => { setSubjectId(u.id); setSubjectName(u.full_name); setSubjectExternalId(u.external_id); }}
              placeholder="Tìm người dùng..."
            /></div>}
          </Field>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">Ở đâu *</legend>
          <div className="flex items-center gap-4">
            {(['zone', 'workstation'] as const).map((type) => (
              <label key={type} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="targetType"
                  value={type}
                  checked={targetType === type}
                  onChange={() => { setTargetType(type); setTargetId(''); }}
                  className="h-4 w-4 rounded border-control accent-accent focus:ring-accent"
                />
                {type === 'zone' ? 'Zone' : 'Máy'}
              </label>
            ))}
          </div>
          <Field
            htmlFor="schedule-target"
            label={targetType === 'zone' ? 'Chọn zone' : 'Chọn máy'}
            error={fieldError('target')}
          >
            <select
              id="schedule-target"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              aria-describedby={describedBy('schedule-target', 'target')}
              className={`w-full ${selectClass}`}
            >
              <option value="">{targetType === 'zone' ? '-- Chọn zone --' : '-- Chọn máy --'}</option>
              {targetType === 'zone' ? zones?.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)
                : workstations?.map((ws) => <option key={ws.id} value={ws.id}>{ws.mqtt_identity} ({ws.hostname})</option>)}
            </select>
          </Field>
        </fieldset>
        <fieldset
          className="space-y-2"
          aria-describedby={fieldDescribedBy('schedule-days', { error: fieldError('days_of_week') })}
        >
          <legend className="text-sm font-medium text-ink">Ngày *</legend>
          <div className="flex flex-wrap gap-3 items-center">
            {DAYS.map(({ day, label }) => <label key={day} className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={daysOfWeek.includes(day)}
                onChange={(e) => setDaysOfWeek((prev) => e.target.checked ? [...prev, day] : prev.filter((d) => d !== day))}
                className="h-4 w-4 rounded border-control accent-accent focus:ring-accent"
              />{label}
            </label>)}
            <Button onClick={() => setDaysOfWeek(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'])}>T2–T6</Button>
            <Button onClick={() => setDaysOfWeek(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'])}>Hằng ngày</Button>
          </div>
          {fieldError('days_of_week') && <p id="schedule-days-error" role="alert" className="text-xs text-danger">{fieldError('days_of_week')}</p>}
        </fieldset>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field htmlFor="schedule-start-time" label="Giờ bắt đầu *" error={fieldError('start_time')}>
            <input
              id="schedule-start-time"
              type="text"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              placeholder="07:30"
              aria-describedby={describedBy('schedule-start-time', 'start_time')}
              className={`w-full ${inputClass}`}
            />
          </Field>
          <Field htmlFor="schedule-end-time" label="Giờ kết thúc *" error={fieldError('end_time')}>
            <input
              id="schedule-end-time"
              type="text"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              placeholder="07:30"
              aria-describedby={describedBy('schedule-end-time', 'end_time')}
              className={`w-full ${inputClass}`}
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field htmlFor="schedule-valid-from" label="Hiệu lực từ *" error={fieldError('valid_from')}>
            <input
              id="schedule-valid-from"
              type="date"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
              placeholder=""
              aria-describedby={describedBy('schedule-valid-from', 'valid_from')}
              className={`w-full ${inputClass}`}
            />
          </Field>
          <Field htmlFor="schedule-valid-to" label="Hiệu lực đến" error={fieldError('valid_to')}>
            <input
              id="schedule-valid-to"
              type="date"
              value={validTo}
              onChange={(e) => setValidTo(e.target.value)}
              placeholder=""
              aria-describedby={describedBy('schedule-valid-to', 'valid_to')}
              className={`w-full ${inputClass}`}
            />
            <Button variant="quiet" onClick={() => setValidTo('')}>Không giới hạn</Button>
          </Field>
        </div>
        <Field htmlFor="schedule-profile" label="Profile" error={fieldError('target_os_username')}>
          <input
            id="schedule-profile"
            type="text"
            value={targetOsUsername}
            onChange={(e) => setTargetOsUsername(e.target.value)}
            placeholder="để trống = profile mặc định của máy"
            aria-describedby={describedBy('schedule-profile', 'target_os_username')}
            className={`w-full ${inputClass}`}
          />
        </Field>
        {/* Warnings Section */}
        {checkFailed && !checkPending && (
          <Notice tone="danger">
            <span>Không kiểm tra được lịch: {errorMessage(checkError)}. Chưa thể lưu.</span>
            <Button
              variant="quiet"
              type="button"
              onClick={() => void retryCheck()}
            >
              Thử lại
            </Button>
          </Notice>
        )}
        {validationResult?.warnings && validationResult.warnings.length > 0 && (
          <Notice tone="warn">
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
                          className="font-mono font-medium text-accent underline"
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
                          className="font-mono font-medium text-accent underline"
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
          </Notice>
        )}

        {/* Bottom Actions */}
        <div className="flex justify-end space-x-3 pt-4 border-t border-line">
          <Button
            variant="secondary"
            type="button"
            onClick={() => navigate('/schedules')}
          >
            Hủy
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={isSaveDisabled}
          >
            {isSaving ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={warningInput !== null}
        title={`Lưu lịch ${name.trim()}?`}
        message="Lịch có cảnh báo (xem bên dưới). Vẫn lưu?"
        confirmLabel="Lưu"
        onCancel={() => setWarningInput(null)}
        onConfirm={() => executeSave(true)}
      />
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
    return <Notice tone="info">Đang tải…</Notice>;
  }

  if (isEdit && isError) {
    return (
      <div className="space-y-4">
        <Link to="/schedules" className="text-sm text-accent hover:underline">
          ← Danh sách lịch
        </Link>
        <Notice tone="danger">{errorMessage(error)}</Notice>
      </div>
    );
  }

  return <ScheduleForm initialSchedule={schedule} scheduleId={id} />;
}
