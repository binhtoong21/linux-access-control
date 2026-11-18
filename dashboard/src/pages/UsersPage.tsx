import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { createUser, listUsers } from '../api/endpoints';
import type { User, UserStatus } from '../api/types';
import { errorMessage } from '../lib/errors';

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function UsersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createExternalId, setCreateExternalId] = useState('');
  const [createFullName, setCreateFullName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['users', { q: debouncedSearch, status: statusFilter }],
    queryFn: ({ pageParam }) =>
      listUsers({
        q: debouncedSearch || undefined,
        status: statusFilter === 'all' ? undefined : (statusFilter as UserStatus),
        cursor: pageParam,
        limit: 50,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  const users: User[] = useMemo(() => {
    return data?.pages.flatMap((page) => page.items) ?? [];
  }, [data]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const extId = createExternalId.trim();
    const name = createFullName.trim();
    const email = createEmail.trim();

    if (!/^[A-Za-z0-9._-]{1,32}$/.test(extId)) {
      setCreateError('Mã chỉ gồm chữ không dấu, số, . _ -, tối đa 32 ký tự');
      return;
    }

    if (!name) {
      setCreateError('Họ tên không được để trống');
      return;
    }

    setIsSubmitting(true);
    try {
      const newUser = await createUser({
        external_id: extId,
        full_name: name,
        email: email || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowCreateForm(false);
      setCreateExternalId('');
      setCreateFullName('');
      setCreateEmail('');
      navigate(`/users/${newUser.id}`);
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl font-bold text-gray-900">Người dùng</h1>
        <button
          type="button"
          onClick={() => setShowCreateForm((prev) => !prev)}
          className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700"
        >
          Thêm người dùng
        </button>
      </div>

      {showCreateForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white p-4 rounded-lg shadow border border-gray-200 space-y-4"
        >
          <div className="font-semibold text-gray-800 text-sm">Thêm người dùng mới</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="create-external-id" className="block text-sm font-medium text-gray-700">
                Mã *
              </label>
              <input
                id="create-external-id"
                type="text"
                value={createExternalId}
                onChange={(e) => setCreateExternalId(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Ví dụ: SV001"
              />
            </div>
            <div>
              <label htmlFor="create-full-name" className="block text-sm font-medium text-gray-700">
                Họ tên *
              </label>
              <input
                id="create-full-name"
                type="text"
                value={createFullName}
                onChange={(e) => setCreateFullName(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Ví dụ: Nguyễn Văn A"
              />
            </div>
            <div>
              <label htmlFor="create-email" className="block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="create-email"
                type="email"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Tùy chọn"
              />
            </div>
          </div>
          {createError && (
            <div className="text-sm text-red-600">{createError}</div>
          )}
          <div className="flex justify-end space-x-2">
            <button
              type="button"
              onClick={() => {
                setShowCreateForm(false);
                setCreateError(null);
              }}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-100"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Đang lưu…' : 'Lưu'}
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="w-full sm:w-72">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo mã hoặc tên"
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
          <label htmlFor="status-filter" className="text-sm font-medium text-gray-700 whitespace-nowrap">
            Trạng thái:
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Tất cả</option>
            <option value="active">Đang hoạt động</option>
            <option value="inactive">Đã vô hiệu hóa</option>
          </select>
        </div>
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
                  <th className="px-4 py-3 text-left">Mã</th>
                  <th className="px-4 py-3 text-left">Họ tên</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Trạng thái</th>
                  <th className="px-4 py-3 text-left">Ngày tạo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                      Chưa có người dùng nào
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr
                      key={u.id}
                      onClick={() => navigate(`/users/${u.id}`)}
                      className="hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-4 py-3 font-medium text-blue-600">
                        <Link
                          to={`/users/${u.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:underline"
                        >
                          {u.external_id}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        <Link
                          to={`/users/${u.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:underline"
                        >
                          {u.full_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{u.email || '—'}</td>
                      <td className="px-4 py-3">
                        {u.status === 'active' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                            Đang hoạt động
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                            Đã vô hiệu hóa
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{formatDate(u.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasNextPage && (
        <div className="text-center pt-2">
          <button
            type="button"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="px-4 py-2 border border-gray-300 rounded text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            {isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
          </button>
        </div>
      )}
    </div>
  );
}
