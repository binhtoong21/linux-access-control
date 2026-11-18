import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'quiet';
  size?: 'sm' | 'md';
  loading?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  type = 'button',
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const variantClasses = {
    primary: 'bg-accent text-white hover:bg-accent-hover',
    secondary: 'bg-surface border border-control text-ink hover:bg-canvas',
    danger: 'bg-danger text-white hover:bg-danger',
    quiet: 'bg-transparent text-accent hover:bg-accent-tint',
  }[variant];

  const sizeClasses = {
    md: 'h-8 px-3 text-sm',
    sm: 'h-7 px-2.5 text-xs',
  }[size];

  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses} ${sizeClasses} ${className}`}
      {...props}
    >
      {children}
      {loading && ' Đang xử lý…'}
    </button>
  );
}
