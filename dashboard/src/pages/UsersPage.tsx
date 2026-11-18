import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { createUser, listUsers } from '../api/endpoints';
import type { User, UserStatus } from '../api/types';
import { errorMessage } from '../lib/errors';
import {
  Button,
  EmptyRow,
  Field,
  inputClass,
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
      <PageHeader
        title="Người dùng"
        actions={
          <Button
            variant="primary"
            onClick={() => setShowCreateForm((prev) => !prev)}
          >
            Thêm người dùng
          </Button>
        }
      />

      {showCreateForm && (
        <form
          onSubmit={handleCreate}
          className="bg-surface p-4 rounded border border-line space-y-4"
        >
          <div className="font-semibold text-ink text-sm">Thêm người dùng mới</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Mã *" htmlFor="create-external-id">
              <input
                id="create-external-id"
                type="text"
                value={createExternalId}
                onChange={(e) => setCreateExternalId(e.target.value)}
                className={`w-full ${inputClass}`}
                placeholder="Ví dụ: SV001"
              />
            </Field>
            <Field label="Họ tên *" htmlFor="create-full-name">
              <input
                id="create-full-name"
                type="text"
                value={createFullName}
                onChange={(e) => setCreateFullName(e.target.value)}
                className={`w-full ${inputClass}`}
                placeholder="Ví dụ: Nguyễn Văn A"
              />
            </Field>
            <Field label="Email" htmlFor="create-email">
              <input
                id="create-email"
                type="email"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                className={`w-full ${inputClass}`}
                placeholder="Tùy chọn"
              />
            </Field>
          </div>
          {createError && (
            <Notice tone="danger">{createError}</Notice>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setShowCreateForm(false);
                setCreateError(null);
              }}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Đang lưu…' : 'Lưu'}
            </Button>
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
            className={`w-full ${inputClass}`}
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <label htmlFor="status-filter" className="text-sm font-medium text-ink whitespace-nowrap">
            Trạng thái:
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
            className={selectClass}
          >
            <option value="all">Tất cả</option>
            <option value="active">Đang hoạt động</option>
            <option value="inactive">Đã vô hiệu hóa</option>
          </select>
        </div>
      </div>

      {isLoading && (
        <div className="py-8 text-center text-sm text-ink-muted">Đang tải…</div>
      )}

      {isError && (
        <Notice tone="danger">{errorMessage(error)}</Notice>
      )}

      {!isLoading && !isError && (
        <Table>
          <THead>
            <TR>
              <TH>Mã</TH>
              <TH>Họ tên</TH>
              <TH>Email</TH>
              <TH>Trạng thái</TH>
              <TH>Ngày tạo</TH>
            </TR>
          </THead>
          <tbody>
            {users.length === 0 ? (
              <EmptyRow colSpan={5}>Chưa có người dùng nào</EmptyRow>
            ) : (
              users.map((u) => (
                <TR
                  key={u.id}
                  interactive
                  onClick={() => navigate(`/users/${u.id}`)}
                  className="cursor-pointer"
                >
                  <TD className="font-mono font-medium text-accent">
                    <Link
                      to={`/users/${u.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:underline"
                    >
                      {u.external_id}
                    </Link>
                  </TD>
                  <TD className="text-ink">
                    <Link
                      to={`/users/${u.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:underline"
                    >
                      {u.full_name}
                    </Link>
                  </TD>
                  <TD className="text-ink-muted">{u.email || '—'}</TD>
                  <TD>
                    <StatusPill tone={u.status === 'active' ? 'ok' : 'neutral'}>
                      {u.status === 'active' ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}
                    </StatusPill>
                  </TD>
                  <TD className="text-ink-muted">{formatDate(u.created_at)}</TD>
                </TR>
              ))
            )}
          </tbody>
        </Table>
      )}

      {hasNextPage && (
        <div className="text-center pt-2">
          <Button
            variant="secondary"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
          </Button>
        </div>
      )}
    </div>
  );
}
