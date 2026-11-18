import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createGroup, listGroups } from '../api/endpoints';
import { errorMessage } from '../lib/errors';

export function GroupsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    data: groups,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['groups'],
    queryFn: listGroups,
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setCreateError('Tên không được để trống');
      return;
    }

    setIsSubmitting(true);
    try {
      await createGroup({
        name: trimmedName,
        description: description.trim() ? description.trim() : null,
      });
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
      setName('');
      setDescription('');
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl font-bold text-gray-900">Nhóm</h1>
      </div>

      <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">Thêm nhóm</h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="group-name" className="block text-sm font-medium text-gray-700">
                Tên *
              </label>
              <input
                id="group-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ví dụ: Lớp K65"
                className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="group-description" className="block text-sm font-medium text-gray-700">
                Mô tả
              </label>
              <input
                id="group-description"
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
              {isSubmitting ? 'Đang thêm…' : 'Thêm nhóm'}
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
                  <th className="px-4 py-3 text-left">Mô tả</th>
                  <th className="px-4 py-3 text-left">Số thành viên</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {groups && groups.length > 0 ? (
                  groups.map((g) => (
                    <tr
                      key={g.id}
                      onClick={() => navigate(`/groups/${g.id}`)}
                      className="hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-4 py-3 font-medium text-blue-600">
                        <Link
                          to={`/groups/${g.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:underline"
                        >
                          {g.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{g.description || '—'}</td>
                      <td className="px-4 py-3 text-gray-900">{g.member_count}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-gray-500">
                      Chưa có nhóm nào
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
