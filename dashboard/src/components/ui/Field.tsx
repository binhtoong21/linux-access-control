import React from 'react';

export interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function fieldDescribedBy(
  id: string,
  opts: { hint?: unknown; error?: unknown },
): string | undefined {
  const parts = [
    opts.hint ? `${id}-hint` : null,
    opts.error ? `${id}-error` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

export const inputClass =
  'bg-surface border border-control rounded h-8 px-2.5 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed';

export const selectClass =
  'bg-surface border border-control rounded h-8 px-2.5 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed';

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className = '',
}: FieldProps) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${htmlFor}-hint`} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
