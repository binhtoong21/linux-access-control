import React, { useState } from 'react';
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

  const [actionError, setActionError] = useState<string | null>(null);
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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setActionError(null);

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
    setActionError(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const handleSaveEdit = async (id: string) => {
    setEditError(null);
    setActionError(null);

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
    setActionError(null);
    const confirmed = window.confirm(
      'Xóa zone này? Các máy trong zone vẫn giữ nguyên, chỉ không còn thuộc zone.',
    );
    if (!confirmed) {
      return;
    }

    setDeletingId(zone.id);
    try {
      await deleteZone(zone.id);
      await queryClient.invalidateQueries({ queryKey: ['zones'] });
      await queryClient.invalidateQueries({ queryKey: ['workstations'] });
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl font-bold text-gray-900">Zone</h1>
      </div>

      {actionError && (
        <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200">
          {actionError}
        </div>
      )}

      {/* Inline Create Form */}
      <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">Thêm zone</h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="zone-name" className="block text-sm font-medium text-gray-700">
                Tên *
              </label>
              <input
                id="zone-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ví dụ: Phòng Lab 01"
                className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="zone-location" className="block text-sm font-medium text-gray-700">
                Vị trí *
              </label>
              <input
                id="zone-location"
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Ví dụ: Tầng 3 Nhà A"
                className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="zone-description" className="block text-sm font-medium text-gray-700">
                Mô tả
              </label>
              <input
                id="zone-description"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tùy chọn"
                className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {createError && (
            <div className="text-sm text-red-600">{createError}</div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Đang thêm…' : 'Thêm zone'}
            </button>
          </div>
        </form>
      </div>

      {isLoading && (
        <div className="p-8 text-center text-gray-500">Đang tải…</div>
      )}

      {isError && (
        <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200">
          {errorMessage(error)}
        </div>
      )}

      {!isLoading && !isError && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-gray-600 font-medium">
                <tr>
                  <th className="px-4 py-3 text-left">Tên</th>
                  <th className="px-4 py-3 text-left">Vị trí</th>
                  <th className="px-4 py-3 text-left">Mô tả</th>
                  <th className="px-4 py-3 text-left">Số máy</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {zones && zones.length > 0 ? (
                  zones.map((zone) => {
                    const isEditingThis = editingId === zone.id;
                    const isDeletingThis = deletingId === zone.id;

                    if (isEditingThis) {
                      return (
                        <tr key={zone.id} className="bg-blue-50/40">
                          <td className="px-4 py-3">
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              aria-label={`Sửa tên ${zone.name}`}
                              className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white"
                            />
                            {editError && (
                              <div className="text-xs text-red-600 mt-1">{editError}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="text"
                              value={editLocation}
                              onChange={(e) => setEditLocation(e.target.value)}
                              aria-label={`Sửa vị trí ${zone.name}`}
                              className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="text"
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                              aria-label={`Sửa mô tả ${zone.name}`}
                              className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white"
                            />
                          </td>
                          <td className="px-4 py-3 text-gray-900">{zone.workstation_count}</td>
                          <td className="px-4 py-3 text-right space-x-2">
                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={() => handleSaveEdit(zone.id)}
                              className="px-2.5 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                            >
                              {isUpdating ? 'Đang lưu…' : 'Lưu'}
                            </button>
                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={handleCancelEdit}
                              className="px-2.5 py-1 border border-gray-300 text-gray-700 rounded text-xs hover:bg-gray-50 disabled:opacity-50"
                            >
                              Hủy
                            </button>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={zone.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{zone.name}</td>
                        <td className="px-4 py-3 text-gray-700">{zone.location}</td>
                        <td className="px-4 py-3 text-gray-500">{zone.description || '—'}</td>
                        <td className="px-4 py-3 text-gray-900">{zone.workstation_count}</td>
                        <td className="px-4 py-3 text-right space-x-2">
                          <button
                            type="button"
                            disabled={isDeletingThis || Boolean(editingId)}
                            onClick={() => handleStartEdit(zone)}
                            className="text-xs px-2.5 py-1 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
                          >
                            Sửa
                          </button>
                          <button
                            type="button"
                            disabled={isDeletingThis || Boolean(editingId)}
                            onClick={() => handleDelete(zone)}
                            className="text-xs px-2.5 py-1 border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
                          >
                            {isDeletingThis ? 'Đang xóa…' : 'Xóa'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                      Chưa có zone nào
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
