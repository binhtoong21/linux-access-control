import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  activateUser,
  deactivateUser,
  disableCard,
  enableCard,
  getCard,
  getUser,
  registerCard,
  unbindCard,
  updateUser,
} from '../api/endpoints';
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

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const userId = id ?? '';
  const queryClient = useQueryClient();

  const [pageError, setPageError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Edit user state
  const [isEditing, setIsEditing] = useState(false);
  const [editFullName, setEditFullName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  // Card UIDs map (loaded on demand)
  const [cardUids, setCardUids] = useState<Record<string, string>>({});
  const [loadingUids, setLoadingUids] = useState<Record<string, boolean>>({});

  // Register card form state
  const [rawUid, setRawUid] = useState('');
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  const {
    data: user,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => getUser(userId),
    enabled: Boolean(userId),
  });

  const handleStartEdit = () => {
    if (!user) return;
    setEditFullName(user.full_name);
    setEditEmail(user.email ?? '');
    setEditError(null);
    setIsEditing(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditError(null);
    const name = editFullName.trim();
    if (!name) {
      setEditError('Họ tên không được để trống');
      return;
    }

    setActionLoading(true);
    try {
      const emailVal = editEmail.trim() ? editEmail.trim() : null;
      await updateUser(userId, {
        full_name: name,
        email: emailVal,
      });
      await queryClient.invalidateQueries({ queryKey: ['user', userId] });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setIsEditing(false);
    } catch (err) {
      setEditError(errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!user) return;
    setPageError(null);

    if (user.status === 'active') {
      const confirmed = window.confirm(
        'Vô hiệu hóa người này? Mọi thẻ của họ sẽ bị từ chối ở các máy sau khi máy nhận dữ liệu mới.',
      );
      if (!confirmed) return;

      setActionLoading(true);
      try {
        await deactivateUser(userId);
        await queryClient.invalidateQueries({ queryKey: ['user', userId] });
        await queryClient.invalidateQueries({ queryKey: ['users'] });
      } catch (err) {
        setPageError(errorMessage(err));
      } finally {
        setActionLoading(false);
      }
    } else {
      setActionLoading(true);
      try {
        await activateUser(userId);
        await queryClient.invalidateQueries({ queryKey: ['user', userId] });
        await queryClient.invalidateQueries({ queryKey: ['users'] });
      } catch (err) {
        setPageError(errorMessage(err));
      } finally {
        setActionLoading(false);
      }
    }
  };

  const handleDisableCard = async (cardId: string) => {
    setPageError(null);
    setActionLoading(true);
    try {
      await disableCard(cardId);
      await queryClient.invalidateQueries({ queryKey: ['user', userId] });
      await queryClient.invalidateQueries({ queryKey: ['cards'] });
    } catch (err) {
      setPageError(errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleEnableCard = async (cardId: string) => {
    setPageError(null);
    setActionLoading(true);
    try {
      await enableCard(cardId);
      await queryClient.invalidateQueries({ queryKey: ['user', userId] });
      await queryClient.invalidateQueries({ queryKey: ['cards'] });
    } catch (err) {
      setPageError(errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnbindCard = async (cardId: string) => {
    const confirmed = window.confirm('Gỡ thẻ này khỏi người dùng?');
    if (!confirmed) return;

    setPageError(null);
    setActionLoading(true);
    try {
      await unbindCard(cardId);
      await queryClient.invalidateQueries({ queryKey: ['user', userId] });
      await queryClient.invalidateQueries({ queryKey: ['cards'] });
    } catch (err) {
      setPageError(errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleViewUid = async (cardId: string) => {
    setPageError(null);
    setLoadingUids((prev) => ({ ...prev, [cardId]: true }));
    try {
      const cardDetail = await getCard(cardId);
      setCardUids((prev) => ({ ...prev, [cardId]: cardDetail.uid }));
    } catch (err) {
      setPageError(errorMessage(err));
    } finally {
      setLoadingUids((prev) => ({ ...prev, [cardId]: false }));
    }
  };

  const handleRegisterCard = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError(null);
    const cleanUid = rawUid.replace(/[\s:]/g, '').toUpperCase();
    if (!cleanUid) {
      setRegisterError('Vui lòng nhập UID');
      return;
    }

    setIsRegistering(true);
    try {
      await registerCard({ uid: cleanUid, user_id: userId });
      setRawUid('');
      await queryClient.invalidateQueries({ queryKey: ['user', userId] });
      await queryClient.invalidateQueries({ queryKey: ['cards'] });
    } catch (err) {
      setRegisterError(errorMessage(err));
    } finally {
      setIsRegistering(false);
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center text-gray-500">Đang tải…</div>;
  }

  if (isError || !user) {
    return (
      <div className="space-y-4">
        <Link to="/users" className="text-sm text-blue-600 hover:underline">
          ← Danh sách người dùng
        </Link>
        <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200">
          {errorMessage(error)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/users" className="text-sm text-blue-600 hover:underline">
          ← Danh sách người dùng
        </Link>
      </div>

      {pageError && (
        <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200">
          {pageError}
        </div>
      )}

      {/* User Information Card */}
      <div className="bg-white p-6 rounded-lg shadow space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{user.full_name}</h1>
            <p className="text-sm text-gray-500 font-mono">Mã: {user.external_id}</p>
          </div>
          <div className="flex items-center space-x-3">
            {user.status === 'active' ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                Đang hoạt động
              </span>
            ) : (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                Đã vô hiệu hóa
              </span>
            )}

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
              onClick={handleToggleStatus}
              disabled={actionLoading}
              className={`px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50 ${
                user.status === 'active'
                  ? 'border border-red-300 text-red-700 hover:bg-red-50'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {user.status === 'active' ? 'Vô hiệu hóa' : 'Kích hoạt lại'}
            </button>
          </div>
        </div>

        {isEditing ? (
          <form onSubmit={handleSaveEdit} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="edit-full-name" className="block text-sm font-medium text-gray-700">
                  Họ tên *
                </label>
                <input
                  id="edit-full-name"
                  type="text"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="edit-email" className="block text-sm font-medium text-gray-700">
                  Email
                </label>
                <input
                  id="edit-email"
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Để trống nếu không có email"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Email: </span>
              <span className="text-gray-900">{user.email || '—'}</span>
            </div>
            <div>
              <span className="text-gray-500">Ngày tạo: </span>
              <span className="text-gray-900">{formatDate(user.created_at)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Section Thẻ */}
      <div className="bg-white p-6 rounded-lg shadow space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Thẻ</h2>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-gray-600 font-medium">
              <tr>
                <th className="px-4 py-3 text-left">Loại thẻ</th>
                <th className="px-4 py-3 text-left">Trạng thái</th>
                <th className="px-4 py-3 text-left">Ngày đăng ký</th>
                <th className="px-4 py-3 text-left">UID</th>
                <th className="px-4 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {user.cards.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                    Người dùng chưa có thẻ nào
                  </td>
                </tr>
              ) : (
                user.cards.map((card) => (
                  <tr key={card.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      Thẻ {card.uid_length} byte
                    </td>
                    <td className="px-4 py-3">
                      {card.status === 'active' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                          Đang hoạt động
                        </span>
                      )}
                      {card.status === 'disabled' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                          Đã khóa
                        </span>
                      )}
                      {card.status === 'unbound' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                          Chưa gắn
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{formatDate(card.created_at)}</td>
                    <td className="px-4 py-3">
                      {cardUids[card.id] ? (
                        <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded border border-gray-300">
                          {cardUids[card.id]}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleViewUid(card.id)}
                          disabled={actionLoading || loadingUids[card.id]}
                          className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                        >
                          {loadingUids[card.id] ? 'Đang đọc…' : 'Xem UID'}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {card.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => handleDisableCard(card.id)}
                          disabled={actionLoading}
                          className="text-xs px-2.5 py-1 border border-amber-300 text-amber-700 rounded hover:bg-amber-50 disabled:opacity-50"
                        >
                          Khóa
                        </button>
                      )}
                      {card.status === 'disabled' && (
                        <button
                          type="button"
                          onClick={() => handleEnableCard(card.id)}
                          disabled={actionLoading}
                          className="text-xs px-2.5 py-1 border border-green-300 text-green-700 rounded hover:bg-green-50 disabled:opacity-50"
                        >
                          Mở khóa
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleUnbindCard(card.id)}
                        disabled={actionLoading}
                        className="text-xs px-2.5 py-1 border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
                      >
                        Gỡ khỏi người dùng
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Register card form */}
        <div className="pt-4 border-t border-gray-100">
          <form onSubmit={handleRegisterCard} className="space-y-2">
            <div className="text-sm font-semibold text-gray-800">Đăng ký thẻ mới</div>
            <div className="flex flex-col sm:flex-row gap-2 max-w-xl">
              <input
                type="text"
                value={rawUid}
                onChange={(e) => setRawUid(e.target.value)}
                placeholder="Nhập UID (ví dụ: 04 A3 2B 1C 5D 6E 80)"
                aria-label="UID thẻ"
                className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={isRegistering || actionLoading}
                className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {isRegistering ? 'Đang đăng ký…' : 'Đăng ký thẻ'}
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Thẻ đã có trong hệ thống mà chưa gắn ai sẽ được gắn lại cho người này.
            </p>
            {registerError && (
              <div className="text-sm text-red-600">{registerError}</div>
            )}
          </form>
        </div>
      </div>

      {/* Section Nhóm */}
      <div className="bg-white p-6 rounded-lg shadow space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Nhóm</h2>
        {user.groups.length === 0 ? (
          <div className="text-sm text-gray-500">Chưa thuộc nhóm nào</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {user.groups.map((group) => (
              <Link
                key={group.id}
                to={`/groups/${group.id}`}
                className="inline-flex items-center px-3 py-1 rounded bg-blue-50 text-blue-700 text-sm hover:bg-blue-100"
              >
                {group.name}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
