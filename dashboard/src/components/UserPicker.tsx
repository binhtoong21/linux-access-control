import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listUsers } from '../api/endpoints';
import type { User } from '../api/types';
import { errorMessage } from '../lib/errors';

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
        className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
      />
      {enabled && (
        <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-52 overflow-y-auto z-10 divide-y divide-gray-100">
          {isLoading && (
            <div className="p-3 text-xs text-gray-500 text-center">Đang tìm…</div>
          )}
          {isError && (
            <div className="p-3 text-xs text-red-600 text-center space-y-1">
              <div>{errorMessage(error)}</div>
              <button
                type="button"
                onClick={() => refetch()}
                className="text-xs text-blue-600 hover:underline font-medium"
              >
                Thử lại
              </button>
            </div>
          )}
          {!isLoading && !isError && users.length === 0 && (
            <div className="p-3 text-xs text-gray-500 text-center">Không tìm thấy</div>
          )}
          {!isLoading &&
            !isError &&
            users.map((u) => (
              <button
                key={u.id}
                type="button"
                disabled={disabled}
                onClick={() => handlePick(u)}
                className="w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {u.external_id} — {u.full_name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
