import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listUsers } from '../api/endpoints';
import type { User } from '../api/types';
import { errorMessage } from '../lib/errors';
import { inputClass } from './ui';

export function UserPicker({
  onPick,
  excludeIds,
  placeholder,
  disabled,
}: {
  onPick: (u: User) => void;
  excludeIds?: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(text.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [text]);

  const enabled = debouncedQuery.length >= 2;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['users', 'pick', debouncedQuery],
    queryFn: () => listUsers({ q: debouncedQuery, status: 'active', limit: 10 }),
    enabled,
  });

  const users = (data?.items ?? []).filter((u) => !excludeIds?.includes(u.id));

  const handlePick = (u: User) => {
    if (disabled) return;
    onPick(u);
    setText('');
    setDebouncedQuery('');
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? 'Tìm người dùng...'}
        className={`w-full ${inputClass}`}
      />
      {enabled && (
        <div className="absolute left-0 right-0 mt-1 bg-surface border border-line rounded shadow-md max-h-52 overflow-y-auto z-10 divide-y divide-line">
          {isLoading && (
            <div className="p-3 text-xs text-ink-muted text-center">Đang tìm…</div>
          )}
          {isError && (
            <div className="p-3 text-xs text-danger text-center space-y-1">
              <div>{errorMessage(error)}</div>
              <button
                type="button"
                onClick={() => refetch()}
                className="text-xs text-accent hover:underline font-medium"
              >
                Thử lại
              </button>
            </div>
          )}
          {!isLoading && !isError && users.length === 0 && (
            <div className="p-3 text-xs text-ink-muted text-center">Không tìm thấy</div>
          )}
          {!isLoading &&
            !isError &&
            users.map((u) => (
              <button
                key={u.id}
                type="button"
                disabled={disabled}
                onClick={() => handlePick(u)}
                className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-accent-tint focus:bg-accent-tint focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {u.external_id} — {u.full_name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
