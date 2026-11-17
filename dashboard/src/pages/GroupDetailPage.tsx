import React, { useState } from 'react';
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

export function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const groupId = id ?? '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [pageError, setPageError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Edit group state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

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

  const handleDeleteGroup = async () => {
    if (!group) return;
    const confirmed = window.confirm('Xóa nhóm này? Thành viên không bị xóa.');
    if (!confirmed) return;

    setPageError(null);
    setActionLoading(true);
    try {
      await deleteGroup(groupId);
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
      navigate('/groups');
    } catch (err) {
      setPageError(errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    const confirmed = window.confirm('Bỏ người dùng này khỏi nhóm?');
    if (!confirmed) return;

    setPageError(null);
    setActionLoading(true);
    try {
      await removeGroupMember(groupId, userId);
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
      await queryClient.invalidateQueries({ queryKey: ['group-members', groupId] });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      setPageError(errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddMembers = async () => {
    if (pickedUsers.length === 0) return;

    setPageError(null);
    setAddSuccess(null);
    setActionLoading(true);
    try {
      const userIds = pickedUsers.map((u) => u.id);
      const res = await addGroupMembers(groupId, userIds);
      setAddSuccess(`Đã thêm ${res.added} người`);
      setPickedUsers([]);
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
      await queryClient.invalidateQueries({ queryKey: ['group-members', groupId] });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      setPageError(errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  if (isLoadingGroups) {
    return <div className="p-8 text-center text-gray-500">Đang tải…</div>;
  }

  if (isGroupsError) {
    return (
      <div className="space-y-4">
        <Link to="/groups" className="text-sm text-blue-600 hover:underline">
          ← Danh sách nhóm
        </Link>
        <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200">
          {errorMessage(groupsError)}
        </div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="space-y-4">
        <Link to="/groups" className="text-sm text-blue-600 hover:underline">
          ← Danh sách nhóm
        </Link>
        <div className="p-4 bg-yellow-50 text-yellow-800 rounded border border-yellow-200">
          Không tìm thấy nhóm
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/groups" className="text-sm text-blue-600 hover:underline">
          ← Danh sách nhóm
        </Link>
      </div>

      {pageError && (
        <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200">
          {pageError}
        </div>
      )}

      {/* Group Information Card */}
      <div className="bg-white p-6 rounded-lg shadow space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{group.name}</h1>
            <p className="text-sm text-gray-500">{group.member_count} thành viên</p>
          </div>
          <div className="flex items-center space-x-3">
            {!isEditing && (
              <button
                type="button"
                onClick={handleStartEdit}
                disabled={actionLoading}
                className="px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                Sửa
              </button>
            )}
            <button
              type="button"
              onClick={handleDeleteGroup}
              disabled={actionLoading}
              className="px-3 py-1.5 border border-red-300 text-red-700 rounded text-sm hover:bg-red-50 disabled:opacity-50"
            >
              Xóa nhóm
            </button>
          </div>
        </div>

        {isEditing ? (
          <form onSubmit={handleSaveEdit} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="edit-group-name" className="block text-sm font-medium text-gray-700">
                  Tên *
                </label>
                <input
                  id="edit-group-name"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="edit-group-desc" className="block text-sm font-medium text-gray-700">
                  Mô tả
                </label>
                <input
                  id="edit-group-desc"
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Tùy chọn"
                />
              </div>
            </div>
            {editError && <div className="text-sm text-red-600">{editError}</div>}
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setEditError(null);
                }}
                disabled={actionLoading}
                className="px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={actionLoading}
                className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {actionLoading ? 'Đang lưu…' : 'Lưu'}
              </button>
            </div>
          </form>
        ) : (
          <div className="text-sm text-gray-700">
            <span className="text-gray-500">Mô tả: </span>
            <span>{group.description || '—'}</span>
          </div>
        )}
      </div>

      {/* Members Section */}
      <div className="bg-white p-6 rounded-lg shadow space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Thành viên</h2>

        {isLoadingMembers && (
          <div className="p-4 text-center text-gray-500">Đang tải thành viên…</div>
        )}

        {isMembersError && (
          <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200">
            {errorMessage(membersError)}
          </div>
        )}

        {!isLoadingMembers && !isMembersError && (
          <div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-gray-600 font-medium">
                  <tr>
                    <th className="px-4 py-3 text-left">Mã</th>
                    <th className="px-4 py-3 text-left">Họ tên</th>
                    <th className="px-4 py-3 text-left">Trạng thái</th>
                    <th className="px-4 py-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {members && members.length > 0 ? (
                    members.map((u) => (
                      <tr key={u.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-blue-600">
                          <Link to={`/users/${u.id}`} className="hover:underline">
                            {u.external_id}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-gray-900">{u.full_name}</td>
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
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(u.id)}
                            disabled={actionLoading}
                            className="text-xs px-2.5 py-1 border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
                          >
                            Bỏ khỏi nhóm
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                        Nhóm chưa có thành viên nào
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-gray-500 mt-2">
              Thay đổi có hiệu lực tại máy sau khi máy nhận dữ liệu mới.
            </p>
          </div>
        )}

        {/* Add Members Area */}
        <div className="pt-4 border-t border-gray-100 space-y-3">
          <h3 className="text-sm font-semibold text-gray-800">Thêm thành viên</h3>
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
            />
          </div>

          {pickedUsers.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {pickedUsers.map((u) => (
                  <span
                    key={u.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-blue-100 text-blue-800 text-xs font-medium"
                  >
                    <span>
                      {u.external_id} — {u.full_name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPickedUsers((prev) => prev.filter((p) => p.id !== u.id))}
                      className="text-blue-600 hover:text-blue-900 font-bold ml-1"
                      aria-label={`Bỏ chọn ${u.full_name}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={handleAddMembers}
                disabled={actionLoading}
                className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {actionLoading ? 'Đang thêm…' : `Thêm ${pickedUsers.length} người`}
              </button>
            </div>
          )}

          {addSuccess && <div className="text-sm text-green-600">{addSuccess}</div>}
        </div>
      </div>
    </div>
  );
}
