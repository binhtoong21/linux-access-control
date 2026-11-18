import React, { useState } from 'react';
import {
  Button,
  ConfirmDialog,
  EmptyRow,
  Field,
  fieldDescribedBy,
  inputClass,
  Notice,
  PageHeader,
  Table,
  THead,
  TH,
  TR,
  TD,
} from '../components/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createZone, deleteZone, listZones, updateZone } from '../api/endpoints';
import type { Zone } from '../api/types';
import { errorMessage } from '../lib/errors';

export function ZonesPage() {
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const [zoneToDelete, setZoneToDelete] = useState<Zone | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const {
    data: zones,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['zones'],
    queryFn: listZones,
  });

  const createNameError = createError === 'Tên không được để trống' ? createError : null;
  const createLocationError = createError === 'Vị trí không được để trống' ? createError : null;
  const editNameError = editError === 'Tên không được để trống' ? editError : null;
  const editLocationError = editError === 'Vị trí không được để trống' ? editError : null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setCreateError('Tên không được để trống');
      return;
    }

    const trimmedLocation = location.trim();
    if (!trimmedLocation) {
      setCreateError('Vị trí không được để trống');
      return;
    }

    setIsSubmitting(true);
    try {
      await createZone({
        name: trimmedName,
        location: trimmedLocation,
        description: description.trim() ? description.trim() : null,
      });
      await queryClient.invalidateQueries({ queryKey: ['zones'] });
      await queryClient.invalidateQueries({ queryKey: ['workstations'] });
      setName('');
      setLocation('');
      setDescription('');
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartEdit = (zone: Zone) => {
    setEditingId(zone.id);
    setEditName(zone.name);
    setEditLocation(zone.location);
    setEditDescription(zone.description || '');
    setEditError(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const handleSaveEdit = async (id: string) => {
    setEditError(null);

    const trimmedName = editName.trim();
    if (!trimmedName) {
      setEditError('Tên không được để trống');
      return;
    }

    const trimmedLocation = editLocation.trim();
    if (!trimmedLocation) {
      setEditError('Vị trí không được để trống');
      return;
    }

    setIsUpdating(true);
    try {
      await updateZone(id, {
        name: trimmedName,
        location: trimmedLocation,
        description: editDescription.trim() ? editDescription.trim() : null,
      });
      await queryClient.invalidateQueries({ queryKey: ['zones'] });
      await queryClient.invalidateQueries({ queryKey: ['workstations'] });
      setEditingId(null);
    } catch (err) {
      setEditError(errorMessage(err));
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async (zone: Zone) => {
    setDeletingId(zone.id);
    try {
      await deleteZone(zone.id);
      await queryClient.invalidateQueries({ queryKey: ['zones'] });
      await queryClient.invalidateQueries({ queryKey: ['workstations'] });
      setZoneToDelete(null);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Zone" />

      {/* Inline Create Form */}
      <div className="bg-surface p-4 rounded border border-line">
        <h2 className="text-base font-semibold text-ink mb-3">Thêm zone</h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field htmlFor="zone-name" label="Tên *" error={createNameError}>
              <input
                id="zone-name"
                aria-describedby={fieldDescribedBy('zone-name', { error: createNameError })}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ví dụ: Phòng Lab 01"
                className={`w-full ${inputClass}`}
              />
            </Field>
            <Field htmlFor="zone-location" label="Vị trí *" error={createLocationError}>
              <input
                id="zone-location"
                aria-describedby={fieldDescribedBy('zone-location', { error: createLocationError })}
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Ví dụ: Tầng 3 Nhà A"
                className={`w-full ${inputClass}`}
              />
            </Field>
            <Field htmlFor="zone-description" label="Mô tả">
              <input
                id="zone-description"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tùy chọn"
                className={`w-full ${inputClass}`}
              />
            </Field>
          </div>


          {createError && !createNameError && !createLocationError && <Notice tone="danger">{createError}</Notice>}
          <div className="flex justify-end">
            <Button
              variant="primary"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Đang thêm…' : 'Thêm zone'}
            </Button>
          </div>
        </form>
      </div>

      {isLoading && (
        <Notice tone="info">Đang tải…</Notice>
      )}

      {isError && (
        <Notice tone="danger">{errorMessage(error)}</Notice>
      )}

      {!isLoading && !isError && (
        <>
          <Table>
            <THead>
              <TR>
                <TH className="text-left">Tên</TH>
                <TH className="text-left">Vị trí</TH>
                <TH className="text-left">Mô tả</TH>
                <TH className="text-left">Số máy</TH>
                <TH className="text-right">Thao tác</TH>
              </TR>
            </THead>
            <tbody>
              {zones && zones.length > 0 ? (
                zones.map((zone) => {
                  const isEditingThis = editingId === zone.id;
                  const isDeletingThis = deletingId === zone.id;

                  if (isEditingThis) {
                    return (
                      <TR key={zone.id} className="bg-accent-tint">
                        <TD>
                          <Field htmlFor="zone-editName" label={`Sửa tên ${zone.name}`} error={editNameError}><input
                            id="zone-editName"
                            aria-describedby={fieldDescribedBy('zone-editName', { error: editNameError })}
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            aria-label={`Sửa tên ${zone.name}`}
                            className={`w-full ${inputClass}`}
                          /></Field>
                        </TD>
                        <TD>
                          <Field htmlFor="zone-editLocation" label={`Sửa vị trí ${zone.name}`} error={editLocationError}><input
                            id="zone-editLocation"
                            aria-describedby={fieldDescribedBy('zone-editLocation', { error: editLocationError })}
                            type="text"
                            value={editLocation}
                            onChange={(e) => setEditLocation(e.target.value)}
                            aria-label={`Sửa vị trí ${zone.name}`}
                            className={`w-full ${inputClass}`}
                          /></Field>
                        </TD>
                        <TD>
                          <Field htmlFor="zone-editDescription" label={`Sửa mô tả ${zone.name}`}><input
                            id="zone-editDescription"
                            type="text"
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            aria-label={`Sửa mô tả ${zone.name}`}
                            className={`w-full ${inputClass}`}
                          /></Field>
                        </TD>
                        <TD className="text-ink">{zone.workstation_count}</TD>
                        <TD className="text-right space-x-2">
                          {editError && !editNameError && !editLocationError && <Notice tone="danger">{editError}</Notice>}
                          <Button
                            variant="primary"
                            type="button"
                            disabled={isUpdating}
                            onClick={() => handleSaveEdit(zone.id)}
                          >
                            {isUpdating ? 'Đang lưu…' : 'Lưu'}
                          </Button>
                          <Button
                            variant="secondary"
                            type="button"
                            disabled={isUpdating}
                            onClick={handleCancelEdit}
                          >
                            Hủy
                          </Button>
                        </TD>
                      </TR>
                    );
                  }

                  return (
                    <TR key={zone.id} className="hover:bg-canvas">
                      <TD className="font-medium text-ink">{zone.name}</TD>
                      <TD className="text-ink">{zone.location}</TD>
                      <TD className="text-ink-muted">{zone.description || '—'}</TD>
                      <TD className="text-ink">{zone.workstation_count}</TD>
                      <TD className="text-right space-x-2">
                        <Button
                          variant="quiet"
                          type="button"
                          disabled={isDeletingThis || Boolean(editingId)}
                          onClick={() => handleStartEdit(zone)}
                        >
                          Sửa
                        </Button>
                        <Button
                          variant="quiet"
                          type="button"
                          disabled={isDeletingThis || Boolean(editingId)}
                          onClick={() => setZoneToDelete(zone)}
                        >
                          {isDeletingThis ? 'Đang xóa…' : 'Xóa'}
                        </Button>
                      </TD>
                    </TR>
                  );
                })
              ) : (
                <EmptyRow colSpan={5}>
                  Chưa có zone nào
                </EmptyRow>
              )}
            </tbody>
          </Table>
        </>
      )}
      <ConfirmDialog
        open={zoneToDelete !== null}
        title={`Xóa zone ${zoneToDelete?.name ?? ''}?`}
        message="Xóa zone này? Các máy trong zone vẫn giữ nguyên, chỉ không còn thuộc zone."
        confirmLabel="Xóa"
        tone="danger"
        onCancel={() => setZoneToDelete(null)}
        onConfirm={async () => { if (zoneToDelete) await handleDelete(zoneToDelete); }}
      />
    </div>
  );
}
