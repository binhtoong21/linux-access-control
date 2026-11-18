import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyRow,
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

function formatUid(raw: string): string {
  const clean = raw.replace(/[\s:]/g, '').toUpperCase();
  const chunks = clean.match(/.{1,2}/g);
  return chunks ? chunks.join(' ') : clean;
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
  const inFlightRef = useRef(false);

  // Binding existing unbound card
  const [bindingCard, setBindingCard] = useState<Card | null>(null);
  const [cardToUnbind, setCardToUnbind] = useState<Card | null>(null);

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

  const handleUnbindConfirm = async () => {
    if (!cardToUnbind) return;
    setActionLoading(true);
    try {
      await unbindCard(cardToUnbind.id);
      await queryClient.invalidateQueries({ queryKey: ['cards'] });
      if (cardToUnbind.owner) {
        await queryClient.invalidateQueries({ queryKey: ['user', cardToUnbind.owner.id] });
      }
      setCardToUnbind(null);
    } finally {
      setActionLoading(false);
    }
  };

  const handlePickUserForBind = async (user: User) => {
    if (!bindingCard || inFlightRef.current || actionLoading) return;
    inFlightRef.current = true;
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
      inFlightRef.current = false;
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
    if (!registerSwipeTarget || inFlightRef.current || actionLoading) return;
    inFlightRef.current = true;
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
      inFlightRef.current = false;
    }
  };

  return (
    <div className="space-y-8">
      {/* SECTION 1: Tra cứu thẻ */}
      <div className="space-y-4">
        <PageHeader title="Tra cứu thẻ" />

        {cardsErrorMsg && (
          <Notice tone="danger">{cardsErrorMsg}</Notice>
        )}

        {cardsSuccessMsg && (
          <Notice tone="ok">{cardsSuccessMsg}</Notice>
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
              className={`w-full ${inputClass} uppercase`}
            />
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <label htmlFor="card-status-filter" className="text-sm font-medium text-ink whitespace-nowrap">
              Trạng thái:
            </label>
            <select
              id="card-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | CardStatus)}
              className={selectClass}
            >
              <option value="all">Tất cả</option>
              <option value="active">Đang dùng</option>
              <option value="disabled">Đã khóa</option>
              <option value="unbound">Chưa gắn</option>
            </select>
          </div>
        </div>

        {isLoadingCards && (
          <div className="py-8 text-center text-sm text-ink-muted">Đang tải thẻ…</div>
        )}

        {isCardsError && (
          <Notice tone="danger">{errorMessage(cardsError)}</Notice>
        )}

        {!isLoadingCards && !isCardsError && (
          <Table>
            <THead>
              <TR>
                <TH>Thẻ</TH>
                <TH>Trạng thái</TH>
                <TH>Chủ thẻ</TH>
                <TH>Ngày đăng ký</TH>
                <TH className="text-right">Thao tác</TH>
              </TR>
            </THead>
            <tbody>
              {cards.length > 0 ? (
                cards.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium text-ink">
                      {c.uid_length} byte
                    </TD>
                    <TD>
                      <StatusPill
                        tone={
                          c.status === 'active'
                            ? 'ok'
                            : c.status === 'disabled'
                              ? 'warn'
                              : 'neutral'
                        }
                      >
                        {c.status === 'active'
                          ? 'Đang dùng'
                          : c.status === 'disabled'
                            ? 'Đã khóa'
                            : 'Chưa gắn'}
                      </StatusPill>
                    </TD>
                    <TD className="text-ink">
                      {c.owner ? (
                        <Link
                          to={`/users/${c.owner.id}`}
                          className="text-accent hover:underline font-medium"
                        >
                          {c.owner.full_name} ({c.owner.external_id})
                        </Link>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </TD>
                    <TD className="text-ink-muted">{formatDate(c.created_at)}</TD>
                    <TD className="text-right space-x-2">
                      {c.status === 'active' && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleDisableCard(c)}
                            disabled={actionLoading}
                          >
                            Khóa
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setCardToUnbind(c)}
                            disabled={actionLoading}
                          >
                            Gỡ
                          </Button>
                        </>
                      )}
                      {c.status === 'disabled' && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleEnableCard(c)}
                            disabled={actionLoading}
                          >
                            Mở khóa
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setCardToUnbind(c)}
                            disabled={actionLoading}
                          >
                            Gỡ
                          </Button>
                        </>
                      )}
                      {c.status === 'unbound' && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => {
                            setBindingCard(c);
                            setCardsErrorMsg(null);
                          }}
                          disabled={actionLoading}
                        >
                          Gắn cho…
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))
              ) : (
                <EmptyRow colSpan={5}>
                  Không tìm thấy thẻ nào
                </EmptyRow>
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

      {/* SECTION 2: Thẻ vừa quẹt chưa đăng ký */}
      <div className="bg-surface border border-line rounded p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-ink">
              Thẻ vừa quẹt chưa đăng ký
            </h2>
            <p className="text-sm text-ink-muted mt-1">
              Quẹt thẻ mới ở bất kỳ máy trạm nào, rồi bấm Làm mới.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refetchLogs()}
            disabled={isFetchingLogs}
          >
            {isFetchingLogs ? 'Đang làm mới…' : 'Làm mới'}
          </Button>
        </div>

        {swipeErrorMsg && (
          <Notice tone="danger">{swipeErrorMsg}</Notice>
        )}

        {swipeSuccessMsg && (
          <Notice tone="ok">{swipeSuccessMsg}</Notice>
        )}

        {isLoadingLogs && (
          <div className="py-8 text-center text-sm text-ink-muted">Đang tải lịch sử quẹt thẻ…</div>
        )}

        {isLogsError && (
          <Notice tone="danger">{errorMessage(logsError)}</Notice>
        )}

        {!isLoadingLogs && !isLogsError && (
          <Table>
            <THead>
              <TR>
                <TH>Thời điểm</TH>
                <TH>Máy</TH>
                <TH>UID</TH>
                <TH className="text-right">Thao tác</TH>
              </TR>
            </THead>
            <tbody>
              {unknownCards.length > 0 ? (
                unknownCards.map((log) => (
                  <TR key={log.id}>
                    <TD className="text-ink-muted">
                      {formatDateTime(log.occurred_at)}
                    </TD>
                    <TD className="font-mono text-xs text-ink">
                      {log.workstation?.mqtt_identity || '—'}
                    </TD>
                    <TD>
                      {log.has_card_uid === false ? (
                        <span className="text-ink-muted">—</span>
                      ) : logUids[log.id] ? (
                        <span className="font-mono text-xs text-ink">
                          {formatUid(logUids[log.id])}
                        </span>
                      ) : (
                        <Button
                          variant="quiet"
                          size="sm"
                          onClick={() => handleViewLogUid(log.id)}
                          disabled={loadingLogUids[log.id] || actionLoading}
                        >
                          {loadingLogUids[log.id] ? 'Đang đọc…' : 'Xem UID'}
                        </Button>
                      )}
                    </TD>
                    <TD className="text-right">
                      {log.has_card_uid === false ? (
                        <span className="text-ink-muted">—</span>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            setRegisterSwipeTarget(log);
                            setSwipeErrorMsg(null);
                          }}
                          disabled={actionLoading}
                        >
                          Gắn cho người dùng…
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))
              ) : (
                <EmptyRow colSpan={4}>
                  Chưa có thẻ nào quẹt gần đây
                </EmptyRow>
              )}
            </tbody>
          </Table>
        )}
      </div>

      {/* Dialog for binding unbound card to user */}
      <Dialog
        open={Boolean(bindingCard)}
        onClose={() => setBindingCard(null)}
        title="Gắn thẻ cho người dùng"
        description={
          bindingCard ? `Chọn người dùng để gắn thẻ (${bindingCard.uid_length} byte):` : undefined
        }
        footer={
          <Button variant="secondary" onClick={() => setBindingCard(null)}>
            Hủy
          </Button>
        }
      >
        <UserPicker
          onPick={handlePickUserForBind}
          placeholder="Tìm người dùng..."
          disabled={actionLoading}
        />
      </Dialog>

      {/* Dialog for registering unknown card swipe to user */}
      <Dialog
        open={Boolean(registerSwipeTarget)}
        onClose={() => setRegisterSwipeTarget(null)}
        title="Gắn thẻ cho người dùng"
        description={
          registerSwipeTarget
            ? `Chọn người dùng để gắn thẻ quẹt lúc ${formatDateTime(registerSwipeTarget.occurred_at)}:`
            : undefined
        }
        footer={
          <Button variant="secondary" onClick={() => setRegisterSwipeTarget(null)}>
            Hủy
          </Button>
        }
      >
        <UserPicker
          onPick={handlePickUserForSwipe}
          placeholder="Tìm người dùng..."
          disabled={actionLoading}
        />
      </Dialog>

      {/* ConfirmDialog: Unbind card */}
      <ConfirmDialog
        open={cardToUnbind !== null}
        title="Gỡ thẻ khỏi người dùng?"
        message="Gỡ thẻ này khỏi người dùng?"
        confirmLabel="Gỡ thẻ"
        tone="danger"
        onConfirm={handleUnbindConfirm}
        onCancel={() => setCardToUnbind(null)}
      />
    </div>
  );
}
