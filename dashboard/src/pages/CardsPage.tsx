import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  bindCard,
  disableCard,
  enableCard,
  getAuditLog,
  listAuditLogs,
  listCards,
  registerCard,
  unbindCard,
} from '../api/endpoints';
import type { AuditLog, Card, CardStatus, User } from '../api/types';
import { errorMessage } from '../lib/errors';
import { UserPicker } from '../components/UserPicker';

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

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function CardsPage() {
  const queryClient = useQueryClient();

  // Section 1: Tra cứu thẻ state
  const [uidInput, setUidInput] = useState('');
  const [debouncedUid, setDebouncedUid] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CardStatus>('all');
  const [cardsErrorMsg, setCardsErrorMsg] = useState<string | null>(null);
  const [cardsSuccessMsg, setCardsSuccessMsg] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Binding existing unbound card
  const [bindingCard, setBindingCard] = useState<Card | null>(null);

  // Section 2: Thẻ vừa quẹt state
  const [swipeErrorMsg, setSwipeErrorMsg] = useState<string | null>(null);
  const [swipeSuccessMsg, setSwipeSuccessMsg] = useState<string | null>(null);
  const [logUids, setLogUids] = useState<Record<string, string>>({});
  const [loadingLogUids, setLoadingLogUids] = useState<Record<string, boolean>>({});
  const [registerSwipeTarget, setRegisterSwipeTarget] = useState<AuditLog | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedUid(uidInput.replace(/[\s:]/g, '').toUpperCase());
    }, 300);
    return () => clearTimeout(timer);
  }, [uidInput]);

  // Query Cards
  const {
    data: cardsData,
    isLoading: isLoadingCards,
    isError: isCardsError,
    error: cardsError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['cards', { uid: debouncedUid, status: statusFilter }],
    queryFn: ({ pageParam }) =>
      listCards({
        uid: debouncedUid || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
        cursor: pageParam,
        limit: 50,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  const cards: Card[] = useMemo(() => {
    return cardsData?.pages.flatMap((page) => page.items) ?? [];
  }, [cardsData]);

  // Query Audit Logs (unknown_card)
  const {
    data: auditData,
    isLoading: isLoadingLogs,
    isError: isLogsError,
    error: logsError,
    refetch: refetchLogs,
    isFetching: isFetchingLogs,
  } = useQuery({
    queryKey: ['audit-logs', { reason: 'unknown_card' }],
    queryFn: () => listAuditLogs({ reason: 'unknown_card', limit: 20 }),
  });

  const unknownCards = auditData?.items ?? [];

  // Card actions
  const handleDisableCard = async (card: Card) => {
    setCardsErrorMsg(null);
    setCardsSuccessMsg(null);
    setActionLoading(true);
    try {
      await disableCard(card.id);
      await queryClient.invalidateQueries({ queryKey: ['cards'] });
      if (card.owner) {
        await queryClient.invalidateQueries({ queryKey: ['user', card.owner.id] });
      }
    } catch (err) {
      setCardsErrorMsg(errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleEnableCard = async (card: Card) => {
    setCardsErrorMsg(null);
    setCardsSuccessMsg(null);
    setActionLoading(true);
    try {
      await enableCard(card.id);
      await queryClient.invalidateQueries({ queryKey: ['cards'] });
      if (card.owner) {
        await queryClient.invalidateQueries({ queryKey: ['user', card.owner.id] });
      }
    } catch (err) {
      setCardsErrorMsg(errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnbindCard = async (card: Card) => {
    const confirmed = window.confirm('Gỡ thẻ này khỏi người dùng?');
    if (!confirmed) return;

    setCardsErrorMsg(null);
    setCardsSuccessMsg(null);
    setActionLoading(true);
    try {
      await unbindCard(card.id);
      await queryClient.invalidateQueries({ queryKey: ['cards'] });
      if (card.owner) {
        await queryClient.invalidateQueries({ queryKey: ['user', card.owner.id] });
      }
    } catch (err) {
      setCardsErrorMsg(errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handlePickUserForBind = async (user: User) => {
    if (!bindingCard) return;
    setCardsErrorMsg(null);
    setCardsSuccessMsg(null);
    setActionLoading(true);
    try {
      await bindCard(bindingCard.id, user.id);
      setCardsSuccessMsg(`Đã gắn thẻ cho ${user.external_id}.`);
      setBindingCard(null);
      await queryClient.invalidateQueries({ queryKey: ['cards'] });
      await queryClient.invalidateQueries({ queryKey: ['user', user.id] });
    } catch (err) {
      setCardsErrorMsg(errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  // Unknown cards actions
  const handleViewLogUid = async (logId: string) => {
    setSwipeErrorMsg(null);
    setLoadingLogUids((prev) => ({ ...prev, [logId]: true }));
    try {
      const detail = await getAuditLog(logId);
      if (detail.card_uid) {
        setLogUids((prev) => ({ ...prev, [logId]: detail.card_uid! }));
      }
    } catch (err) {
      setSwipeErrorMsg(errorMessage(err));
    } finally {
      setLoadingLogUids((prev) => ({ ...prev, [logId]: false }));
    }
  };

  const handlePickUserForSwipe = async (user: User) => {
    if (!registerSwipeTarget) return;
    setSwipeErrorMsg(null);
    setSwipeSuccessMsg(null);
    setActionLoading(true);
    try {
      await registerCard({
        from_audit_entry_id: registerSwipeTarget.entry_id,
        user_id: user.id,
      });
      setSwipeSuccessMsg(`Đã gắn thẻ cho ${user.external_id}.`);
      setRegisterSwipeTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['cards'] });
      await queryClient.invalidateQueries({ queryKey: ['user', user.id] });
      await queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    } catch (err) {
      setSwipeErrorMsg(errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* SECTION 1: Tra cứu thẻ */}
      <div className="bg-white p-6 rounded-lg shadow space-y-4">
        <h1 className="text-xl font-bold text-gray-900">Tra cứu thẻ</h1>

        {cardsErrorMsg && (
          <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200 text-sm">
            {cardsErrorMsg}
          </div>
        )}

        {cardsSuccessMsg && (
          <div className="p-4 bg-green-50 text-green-700 rounded border border-green-200 text-sm">
            {cardsSuccessMsg}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="w-full sm:w-80">
            <label htmlFor="search-uid" className="sr-only">
              Tìm theo UID
            </label>
            <input
              id="search-uid"
              type="text"
              value={uidInput}
              onChange={(e) => setUidInput(e.target.value)}
              placeholder="Nhập UID (ví dụ: 04 A3 2B 1C 5D 6E 80)"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
            <label htmlFor="card-status-filter" className="text-sm font-medium text-gray-700 whitespace-nowrap">
              Trạng thái:
            </label>
            <select
              id="card-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | CardStatus)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Tất cả</option>
              <option value="active">Đang dùng</option>
              <option value="disabled">Đã khóa</option>
              <option value="unbound">Chưa gắn</option>
            </select>
          </div>
        </div>

        {isLoadingCards && (
          <div className="p-8 text-center text-gray-500">Đang tải thẻ…</div>
        )}

        {isCardsError && (
          <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200 text-sm">
            {errorMessage(cardsError)}
          </div>
        )}

        {!isLoadingCards && !isCardsError && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-gray-600 font-medium">
                <tr>
                  <th className="px-4 py-3 text-left">Thẻ</th>
                  <th className="px-4 py-3 text-left">Trạng thái</th>
                  <th className="px-4 py-3 text-left">Chủ thẻ</th>
                  <th className="px-4 py-3 text-left">Ngày đăng ký</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {cards.length > 0 ? (
                  cards.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {c.uid_length} byte
                      </td>
                      <td className="px-4 py-3">
                        {c.status === 'active' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                            Đang dùng
                          </span>
                        )}
                        {c.status === 'disabled' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                            Đã khóa
                          </span>
                        )}
                        {c.status === 'unbound' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                            Chưa gắn
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        {c.owner ? (
                          <Link
                            to={`/users/${c.owner.id}`}
                            className="text-blue-600 hover:underline font-medium"
                          >
                            {c.owner.full_name} ({c.owner.external_id})
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{formatDate(c.created_at)}</td>
                      <td className="px-4 py-3 text-right space-x-2">
                        {c.status === 'active' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleDisableCard(c)}
                              disabled={actionLoading}
                              className="text-xs px-2.5 py-1 border border-amber-300 text-amber-700 rounded hover:bg-amber-50 disabled:opacity-50"
                            >
                              Khóa
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUnbindCard(c)}
                              disabled={actionLoading}
                              className="text-xs px-2.5 py-1 border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
                            >
                              Gỡ
                            </button>
                          </>
                        )}
                        {c.status === 'disabled' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleEnableCard(c)}
                              disabled={actionLoading}
                              className="text-xs px-2.5 py-1 border border-green-300 text-green-700 rounded hover:bg-green-50 disabled:opacity-50"
                            >
                              Mở khóa
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUnbindCard(c)}
                              disabled={actionLoading}
                              className="text-xs px-2.5 py-1 border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
                            >
                              Gỡ
                            </button>
                          </>
                        )}
                        {c.status === 'unbound' && (
                          <button
                            type="button"
                            onClick={() => {
                              setBindingCard(c);
                              setCardsErrorMsg(null);
                            }}
                            disabled={actionLoading}
                            className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                          >
                            Gắn cho…
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                      Không tìm thấy thẻ nào
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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

      {/* Modal for binding unbound card to user */}
      {bindingCard && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-semibold text-gray-900">
                Gắn thẻ cho người dùng
              </h3>
              <button
                type="button"
                onClick={() => setBindingCard(null)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-gray-600">
              Chọn người dùng để gắn thẻ ({bindingCard.uid_length} byte):
            </p>
            <UserPicker onPick={handlePickUserForBind} placeholder="Tìm người dùng..." />
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setBindingCard(null)}
                className="px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-100"
              >
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: Thẻ vừa quẹt chưa đăng ký */}
      <div className="bg-white p-6 rounded-lg shadow space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              Thẻ vừa quẹt chưa đăng ký
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Quẹt thẻ mới ở bất kỳ máy trạm nào, rồi bấm Làm mới.
            </p>
          </div>
          <button
            type="button"
            onClick={() => refetchLogs()}
            disabled={isFetchingLogs}
            className="px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 whitespace-nowrap self-start sm:self-auto"
          >
            {isFetchingLogs ? 'Đang làm mới…' : 'Làm mới'}
          </button>
        </div>

        {swipeErrorMsg && (
          <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200 text-sm">
            {swipeErrorMsg}
          </div>
        )}

        {swipeSuccessMsg && (
          <div className="p-4 bg-green-50 text-green-700 rounded border border-green-200 text-sm">
            {swipeSuccessMsg}
          </div>
        )}

        {isLoadingLogs && (
          <div className="p-8 text-center text-gray-500">Đang tải lịch sử quẹt thẻ…</div>
        )}

        {isLogsError && (
          <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200 text-sm">
            {errorMessage(logsError)}
          </div>
        )}

        {!isLoadingLogs && !isLogsError && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-gray-600 font-medium">
                <tr>
                  <th className="px-4 py-3 text-left">Thời điểm</th>
                  <th className="px-4 py-3 text-left">Máy</th>
                  <th className="px-4 py-3 text-left">UID</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {unknownCards.length > 0 ? (
                  unknownCards.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700">
                        {formatDateTime(log.occurred_at)}
                      </td>
                      <td className="px-4 py-3 text-gray-900 font-mono text-xs">
                        {log.workstation?.mqtt_identity || '—'}
                      </td>
                      <td className="px-4 py-3">
                        {log.has_card_uid === false ? (
                          '—'
                        ) : logUids[log.id] ? (
                          <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded border border-gray-300">
                            {logUids[log.id]}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleViewLogUid(log.id)}
                            disabled={loadingLogUids[log.id] || actionLoading}
                            className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                          >
                            {loadingLogUids[log.id] ? 'Đang đọc…' : 'Xem UID'}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {log.has_card_uid === false ? (
                          '—'
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setRegisterSwipeTarget(log);
                              setSwipeErrorMsg(null);
                            }}
                            disabled={actionLoading}
                            className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                          >
                            Gắn cho người dùng…
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                      Chưa có thẻ nào quẹt gần đây
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal for registering unknown card swipe to user */}
      {registerSwipeTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-semibold text-gray-900">
                Gắn thẻ cho người dùng
              </h3>
              <button
                type="button"
                onClick={() => setRegisterSwipeTarget(null)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-gray-600">
              Chọn người dùng để gắn thẻ quẹt lúc{' '}
              {formatDateTime(registerSwipeTarget.occurred_at)}:
            </p>
            <UserPicker onPick={handlePickUserForSwipe} placeholder="Tìm người dùng..." />
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setRegisterSwipeTarget(null)}
                className="px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-100"
              >
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
