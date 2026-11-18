import React from 'react';

export interface NoticeProps {
  tone: 'info' | 'ok' | 'warn' | 'danger';
  title?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function Notice({
  tone,
  title,
  children,
  action,
  className = '',
}: NoticeProps) {
  const toneClasses = {
    info: 'bg-accent-tint border-accent',
    ok: 'bg-ok-tint border-ok',
    warn: 'bg-warn-tint border-warn',
    danger: 'bg-danger-tint border-danger',
  }[tone];

  const role = tone === 'warn' || tone === 'danger' ? 'alert' : 'status';

  return (
    <div
      role={role}
      className={`border-l-[3px] rounded-r p-3 ${toneClasses} ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          {title && <div className="text-sm font-semibold text-ink">{title}</div>}
          <div className="text-sm text-ink">{children}</div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}
