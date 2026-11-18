import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createGroup, listGroups } from '../api/endpoints';
import { errorMessage } from '../lib/errors';
import {
  Button,
  EmptyRow,
  Field,
  inputClass,
  Notice,
  PageHeader,
  Table,
  TD,
  TH,
  THead,
  TR,
} from '../components/ui';

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
      <PageHeader title="Nhóm" />

      <div className="bg-surface border border-line rounded p-4 space-y-4">
        <h2 className="text-base font-semibold text-ink">Thêm nhóm</h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Tên *" htmlFor="group-name">
              <input
                id="group-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ví dụ: Lớp K65"
                className={`w-full ${inputClass}`}
              />
            </Field>
            <Field label="Mô tả" htmlFor="group-description">
              <input
                id="group-description"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tùy chọn"
                className={`w-full ${inputClass}`}
              />
            </Field>
          </div>

          {createError && (
            <Notice tone="danger">{createError}</Notice>
          )}

          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Đang thêm…' : 'Thêm nhóm'}
            </Button>
          </div>
        </form>
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
              <TH>Tên</TH>
              <TH>Mô tả</TH>
              <TH>Số thành viên</TH>
            </TR>
          </THead>
          <tbody>
            {groups && groups.length > 0 ? (
              groups.map((g) => (
                <TR
                  key={g.id}
                  interactive
                  onClick={() => navigate(`/groups/${g.id}`)}
                  className="cursor-pointer"
                >
                  <TD className="font-medium text-accent">
                    <Link
                      to={`/groups/${g.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:underline"
                    >
                      {g.name}
                    </Link>
                  </TD>
                  <TD className="text-ink-muted">{g.description || '—'}</TD>
                  <TD className="text-ink tabular-nums">{g.member_count}</TD>
                </TR>
              ))
            ) : (
              <EmptyRow colSpan={3}>
                Chưa có nhóm nào
              </EmptyRow>
            )}
          </tbody>
        </Table>
      )}
    </div>
  );
}
