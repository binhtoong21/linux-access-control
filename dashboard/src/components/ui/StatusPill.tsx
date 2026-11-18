import React from 'react';

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral';
  children: React.ReactNode;
  title?: string;
}

export function StatusPill({
  tone,
  children,
  title,
  className = '',
  ...props
}: StatusPillProps) {
  const toneClasses = {
    ok: 'bg-ok-tint text-ok',
    warn: 'bg-warn-tint text-warn',
    danger: 'bg-danger-tint text-danger',
    info: 'bg-accent-tint text-accent',
    neutral: 'bg-canvas text-ink-muted',
  }[tone];

  return (
    <span
      title={title}
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${toneClasses} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
