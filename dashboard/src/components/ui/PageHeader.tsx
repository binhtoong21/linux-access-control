import React from 'react';

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  className = '',
}: PageHeaderProps) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${className}`}>
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {description && (
          <p className="text-sm text-ink-muted mt-1">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
