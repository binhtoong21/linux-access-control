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

function formatUid(raw: string): string {
  const clean = raw.replace(/[\s:]/g, '').toUpperCase();
  const chunks = clean.match(/.{1,2}/g);
  return chunks ? chunks.join(' ') : clean;
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

  // Dialog states
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);
  const [cardToUnbindId, setCardToUnbindId] = useState<string | null>(null);

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
      setDeactivateDialogOpen(true);
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

  const handleDeactivateConfirm = async () => {
    setActionLoading(true);
    try {
      await deactivateUser(userId);
      await queryClient.invalidateQueries({ queryKey: ['user', userId] });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setDeactivateDialogOpen(false);
    } finally {
      setActionLoading(false);
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

  const handleUnbindConfirm = async () => {
    if (!cardToUnbindId) return;
    setActionLoading(true);
    try {
      await unbindCard(cardToUnbindId);
      await queryClient.invalidateQueries({ queryKey: ['user', userId] });
      await queryClient.invalidateQueries({ queryKey: ['cards'] });
      setCardToUnbindId(null);
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
    return <div className="py-8 text-center text-sm text-ink-muted">Đang tải…</div>;
  }

  if (isError || !user) {
    return (
      <div className="space-y-4">
        <div>
          <Link to="/users" className="text-sm text-accent hover:underline">
            ← Danh sách người dùng
          </Link>
        </div>
        <Notice tone="danger">
          {errorMessage(error)}
        </Notice>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/users" className="text-sm text-accent hover:underline">
          ← Danh sách người dùng
        </Link>
      </div>

      {pageError && (
        <Notice tone="danger">{pageError}</Notice>
      )}

      {/* User Information Card */}
      <div className="bg-surface border border-line rounded p-6 space-y-4">
        <PageHeader
          title={user.full_name}
          description={<span className="font-mono">Mã: {user.external_id}</span>}
          actions={
            <div className="flex items-center gap-2">
              <StatusPill tone={user.status === 'active' ? 'ok' : 'neutral'}>
                {user.status === 'active' ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}
              </StatusPill>

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
                variant={user.status === 'active' ? 'danger' : 'secondary'}
                size="sm"
                onClick={handleToggleStatus}
                disabled={actionLoading}
              >
                {user.status === 'active' ? 'Vô hiệu hóa' : 'Kích hoạt lại'}
              </Button>
            </div>
          }
        />

        {isEditing ? (
          <form onSubmit={handleSaveEdit} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Họ tên *" htmlFor="edit-full-name">
                <input
                  id="edit-full-name"
                  type="text"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className={`w-full ${inputClass}`}
                />
              </Field>
              <Field label="Email" htmlFor="edit-email">
                <input
                  id="edit-email"
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className={`w-full ${inputClass}`}
                  placeholder="Để trống nếu không có email"
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
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs font-medium text-ink-muted">Email</dt>
              <dd className="text-sm text-ink mt-0.5">{user.email || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-ink-muted">Ngày tạo</dt>
              <dd className="text-sm text-ink mt-0.5">{formatDate(user.created_at)}</dd>
            </div>
          </dl>
        )}
      </div>

      {/* Section Thẻ */}
      <div className="bg-surface border border-line rounded p-6 space-y-4">
        <h2 className="text-base font-semibold text-ink">Thẻ</h2>

        <Table>
          <THead>
            <TR>
              <TH>Loại thẻ</TH>
              <TH>Trạng thái</TH>
              <TH>Ngày đăng ký</TH>
              <TH>UID</TH>
              <TH className="text-right">Thao tác</TH>
            </TR>
          </THead>
          <tbody>
            {user.cards.length === 0 ? (
              <EmptyRow colSpan={5}>
                Người dùng chưa có thẻ nào
              </EmptyRow>
            ) : (
              user.cards.map((card) => (
                <TR key={card.id}>
                  <TD className="font-medium text-ink">
                    Thẻ {card.uid_length} byte
                  </TD>
                  <TD>
                    <StatusPill
                      tone={
                        card.status === 'active'
                          ? 'ok'
                          : card.status === 'disabled'
                            ? 'warn'
                            : 'neutral'
                      }
                    >
                      {card.status === 'active'
                        ? 'Đang hoạt động'
                        : card.status === 'disabled'
                          ? 'Đã khóa'
                          : 'Chưa gắn'}
                    </StatusPill>
                  </TD>
                  <TD className="text-ink-muted">{formatDate(card.created_at)}</TD>
                  <TD>
                    {cardUids[card.id] ? (
                      <span className="font-mono text-xs text-ink">
                        {formatUid(cardUids[card.id])}
                      </span>
                    ) : (
                      <Button
                        variant="quiet"
                        size="sm"
                        onClick={() => handleViewUid(card.id)}
                        disabled={actionLoading || loadingUids[card.id]}
                      >
                        {loadingUids[card.id] ? 'Đang đọc…' : 'Xem UID'}
                      </Button>
                    )}
                  </TD>
                  <TD className="text-right space-x-2">
                    {card.status === 'active' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleDisableCard(card.id)}
                        disabled={actionLoading}
                      >
                        Khóa
                      </Button>
                    )}
                    {card.status === 'disabled' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleEnableCard(card.id)}
                        disabled={actionLoading}
                      >
                        Mở khóa
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setCardToUnbindId(card.id)}
                      disabled={actionLoading}
                    >
                      Gỡ khỏi người dùng
                    </Button>
                  </TD>
                </TR>
              ))
            )}
          </tbody>
        </Table>

        {/* Register card form */}
        <div className="pt-4 border-t border-line">
          <form onSubmit={handleRegisterCard} className="space-y-2">
            <div className="text-sm font-semibold text-ink">Đăng ký thẻ mới</div>
            <div className="flex flex-col sm:flex-row gap-2 max-w-xl">
              <input
                type="text"
                value={rawUid}
                onChange={(e) => setRawUid(e.target.value)}
                placeholder="Nhập UID (ví dụ: 04 A3 2B 1C 5D 6E 80)"
                aria-label="UID thẻ"
                className={`flex-1 ${inputClass} uppercase`}
              />
              <Button
                type="submit"
                variant="primary"
                disabled={isRegistering || actionLoading}
              >
                {isRegistering ? 'Đang đăng ký…' : 'Đăng ký thẻ'}
              </Button>
            </div>
            <p className="text-xs text-ink-muted">
              Thẻ đã có trong hệ thống mà chưa gắn ai sẽ được gắn lại cho người này.
            </p>
            {registerError && (
              <Notice tone="danger">{registerError}</Notice>
            )}
          </form>
        </div>
      </div>

      {/* Section Nhóm */}
      <div className="bg-surface border border-line rounded p-6 space-y-4">
        <h2 className="text-base font-semibold text-ink">Nhóm</h2>
        {user.groups.length === 0 ? (
          <div className="text-sm text-ink-muted">Chưa thuộc nhóm nào</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {user.groups.map((group) => (
              <Link
                key={group.id}
                to={`/groups/${group.id}`}
                className="inline-flex items-center px-2.5 py-1 rounded bg-accent-tint text-accent text-sm hover:underline"
              >
                {group.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ConfirmDialog: Deactivate user */}
      <ConfirmDialog
        open={deactivateDialogOpen}
        title={`Vô hiệu hóa người dùng ${user.full_name}?`}
        message="Vô hiệu hóa người này? Mọi thẻ của họ sẽ bị từ chối ở các máy sau khi máy nhận dữ liệu mới."
        confirmLabel="Vô hiệu hóa"
        tone="danger"
        onConfirm={handleDeactivateConfirm}
        onCancel={() => setDeactivateDialogOpen(false)}
      />

      {/* ConfirmDialog: Unbind card */}
      <ConfirmDialog
        open={cardToUnbindId !== null}
        title="Gỡ thẻ khỏi người dùng?"
        message="Gỡ thẻ này khỏi người dùng?"
        confirmLabel="Gỡ thẻ"
        tone="danger"
        onConfirm={handleUnbindConfirm}
        onCancel={() => setCardToUnbindId(null)}
      />
    </div>
  );
}
