import React from 'react';

export interface EmptyStateProps {
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  children,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center p-8 text-ink-muted space-y-2 ${className}`}>
      <div className="text-base font-medium text-ink">{title}</div>
      {children && <div className="text-sm text-ink-muted">{children}</div>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
