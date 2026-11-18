import React, { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addGroupMembers,
  deleteGroup,
  listGroupMembers,
  listGroups,
  removeGroupMember,
  updateGroup,
} from '../api/endpoints';
import type { User } from '../api/types';
import { errorMessage } from '../lib/errors';
import { UserPicker } from '../components/UserPicker';
import {
  Button,
  ConfirmDialog,
  EmptyRow,
  Field,
  inputClass,
  Notice,
  PageHeader,
  StatusPill,
  Table,
  TD,
  TH,
  THead,
  TR,
} from '../components/ui';

export function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const groupId = id ?? '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [pageError, setPageError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const inFlightRef = useRef(false);

  // Edit group state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToRemove, setUserToRemove] = useState<User | null>(null);

  // Picked users to add
  const [pickedUsers, setPickedUsers] = useState<User[]>([]);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  const {
    data: groups,
    isLoading: isLoadingGroups,
    isError: isGroupsError,
    error: groupsError,
  } = useQuery({
    queryKey: ['groups'],
    queryFn: listGroups,
  });

  const group = groups?.find((g) => g.id === groupId);

  const {
    data: members,
    isLoading: isLoadingMembers,
    isError: isMembersError,
    error: membersError,
  } = useQuery({
    queryKey: ['group-members', groupId],
    queryFn: () => listGroupMembers(groupId),
    enabled: Boolean(groupId),
  });

  const handleStartEdit = () => {
    if (!group) return;
    setEditName(group.name);
    setEditDescription(group.description ?? '');
    setEditError(null);
    setIsEditing(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditError(null);
    const trimmed = editName.trim();
    if (!trimmed) {
      setEditError('Tên không được để trống');
      return;
    }

    setActionLoading(true);
    try {
      await updateGroup(groupId, {
        name: trimmed,
        description: editDescription.trim() ? editDescription.trim() : null,
      });
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
      setIsEditing(false);
    } catch (err) {
      setEditError(errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteGroupConfirm = async () => {
    if (!group) return;
    setActionLoading(true);
    try {
      await deleteGroup(groupId);
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
      setDeleteDialogOpen(false);
      navigate('/groups');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveMemberConfirm = async () => {
    if (!userToRemove) return;
    setActionLoading(true);
    try {
      await removeGroupMember(groupId, userToRemove.id);
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
      await queryClient.invalidateQueries({ queryKey: ['group-members', groupId] });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setUserToRemove(null);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddMembers = async () => {
    if (pickedUsers.length === 0 || inFlightRef.current || actionLoading) return;

    inFlightRef.current = true;
    setPageError(null);
    setAddSuccess(null);
    setActionLoading(true);
    try {
      const userIds = pickedUsers.map((u) => u.id);
      const res = await addGroupMembers(groupId, userIds);
      if (res.added.length === 0) {
        setAddSuccess('Những người này đã có trong nhóm.');
      } else {
        setAddSuccess(`Đã thêm ${res.added.length} người`);
      }
      setPickedUsers([]);
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
      await queryClient.invalidateQueries({ queryKey: ['group-members', groupId] });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      setPageError(errorMessage(err));
    } finally {
      setActionLoading(false);
      inFlightRef.current = false;
    }
  };

  if (isLoadingGroups) {
    return <div className="py-8 text-center text-sm text-ink-muted">Đang tải…</div>;
  }

  if (isGroupsError) {
    return (
      <div className="space-y-4">
        <div>
          <Link to="/groups" className="text-sm text-accent hover:underline">
            ← Danh sách nhóm
          </Link>
        </div>
        <Notice tone="danger">
          {errorMessage(groupsError)}
        </Notice>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="space-y-4">
        <div>
          <Link to="/groups" className="text-sm text-accent hover:underline">
            ← Danh sách nhóm
          </Link>
        </div>
        <Notice tone="warn">
          Không tìm thấy nhóm
        </Notice>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/groups" className="text-sm text-accent hover:underline">
          ← Danh sách nhóm
        </Link>
      </div>

      {pageError && (
        <Notice tone="danger">{pageError}</Notice>
      )}

      {/* Group Information Card */}
      <div className="bg-surface border border-line rounded p-6 space-y-4">
        <PageHeader
          title={group.name}
          description={`${group.member_count} thành viên`}
          actions={
            <div className="flex items-center gap-2">
              {!isEditing && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleStartEdit}
                  disabled={actionLoading}
                >
                  Sửa
                </Button>
              )}
              <Button
                variant="danger"
                size="sm"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={actionLoading}
              >
                Xóa nhóm
              </Button>
            </div>
          }
        />

        {isEditing ? (
          <form onSubmit={handleSaveEdit} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Tên *" htmlFor="edit-group-name">
                <input
                  id="edit-group-name"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className={`w-full ${inputClass}`}
                />
              </Field>
              <Field label="Mô tả" htmlFor="edit-group-desc">
                <input
                  id="edit-group-desc"
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className={`w-full ${inputClass}`}
                  placeholder="Tùy chọn"
                />
              </Field>
            </div>
            {editError && <Notice tone="danger">{editError}</Notice>}
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setIsEditing(false);
                  setEditError(null);
                }}
                disabled={actionLoading}
              >
                Hủy
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={actionLoading}
              >
                Lưu
              </Button>
            </div>
          </form>
        ) : (
          <div className="text-sm text-ink">
            <span className="text-ink-muted">Mô tả: </span>
            <span>{group.description || '—'}</span>
          </div>
        )}
      </div>

      {/* Members Section */}
      <div className="bg-surface border border-line rounded p-6 space-y-4">
        <h2 className="text-base font-semibold text-ink">Thành viên</h2>

        {isLoadingMembers && (
          <div className="py-4 text-center text-sm text-ink-muted">Đang tải thành viên…</div>
        )}

        {isMembersError && (
          <Notice tone="danger">{errorMessage(membersError)}</Notice>
        )}

        {!isLoadingMembers && !isMembersError && (
          <div>
            <Table>
              <THead>
                <TR>
                  <TH>Mã</TH>
                  <TH>Họ tên</TH>
                  <TH>Trạng thái</TH>
                  <TH className="text-right">Thao tác</TH>
                </TR>
              </THead>
              <tbody>
                {members && members.length > 0 ? (
                  members.map((u) => (
                    <TR key={u.id}>
                      <TD className="font-mono font-medium text-accent">
                        <Link to={`/users/${u.id}`} className="hover:underline">
                          {u.external_id}
                        </Link>
                      </TD>
                      <TD className="text-ink">{u.full_name}</TD>
                      <TD>
                        <StatusPill tone={u.status === 'active' ? 'ok' : 'neutral'}>
                          {u.status === 'active' ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}
                        </StatusPill>
                      </TD>
                      <TD className="text-right">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setUserToRemove(u)}
                          disabled={actionLoading}
                        >
                          Bỏ khỏi nhóm
                        </Button>
                      </TD>
                    </TR>
                  ))
                ) : (
                  <EmptyRow colSpan={4}>
                    Nhóm chưa có thành viên nào
                  </EmptyRow>
                )}
              </tbody>
            </Table>

            <p className="text-xs text-ink-muted mt-2">
              Thay đổi có hiệu lực tại máy sau khi máy nhận dữ liệu mới.
            </p>
          </div>
        )}

        {/* Add Members Area */}
        <div className="pt-4 border-t border-line space-y-3">
          <h3 className="text-sm font-semibold text-ink">Thêm thành viên</h3>
          <div className="max-w-md">
            <UserPicker
              onPick={(user) => {
                if (!pickedUsers.some((u) => u.id === user.id)) {
                  setPickedUsers((prev) => [...prev, user]);
                }
              }}
              excludeIds={[
                ...(members?.map((m) => m.id) ?? []),
                ...pickedUsers.map((u) => u.id),
              ]}
              placeholder="Tìm người dùng để thêm..."
              disabled={actionLoading}
            />
          </div>

          {pickedUsers.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {pickedUsers.map((u) => (
                  <span
                    key={u.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-accent-tint text-accent text-xs font-medium"
                  >
                    <span>
                      {u.external_id} — {u.full_name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPickedUsers((prev) => prev.filter((p) => p.id !== u.id))}
                      className="text-accent hover:opacity-75 font-bold ml-1"
                      aria-label={`Bỏ chọn ${u.full_name}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <Button
                variant="primary"
                onClick={handleAddMembers}
                disabled={actionLoading}
              >
                {actionLoading ? 'Đang thêm…' : `Thêm ${pickedUsers.length} người`}
              </Button>
            </div>
          )}

          {addSuccess && <Notice tone="ok">{addSuccess}</Notice>}
        </div>
      </div>

      {/* ConfirmDialog: Delete group */}
      <ConfirmDialog
        open={deleteDialogOpen}
        title={`Xóa nhóm ${group.name}?`}
        message="Xóa nhóm này? Thành viên không bị xóa."
        confirmLabel="Xóa nhóm"
        tone="danger"
        onConfirm={handleDeleteGroupConfirm}
        onCancel={() => setDeleteDialogOpen(false)}
      />

      {/* ConfirmDialog: Remove member */}
      <ConfirmDialog
        open={userToRemove !== null}
        title={`Bỏ người dùng khỏi nhóm?`}
        message="Bỏ người dùng này khỏi nhóm?"
        confirmLabel="Bỏ khỏi nhóm"
        tone="danger"
        onConfirm={handleRemoveMemberConfirm}
        onCancel={() => setUserToRemove(null)}
      />
    </div>
  );
}
