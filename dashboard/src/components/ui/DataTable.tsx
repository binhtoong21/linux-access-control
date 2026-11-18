import React from 'react';

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  containerClassName?: string;
}

export function Table({
  children,
  className = '',
  containerClassName = '',
  ...props
}: TableProps) {
  return (
    <div className={`overflow-x-auto border border-line bg-surface rounded ${containerClassName}`}>
      <table className={`min-w-full text-left text-sm ${className}`} {...props}>
        {children}
      </table>
    </div>
  );
}

export function THead({
  children,
  className = '',
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={`bg-surface ${className}`} {...props}>
      {children}
    </thead>
  );
}

export function TH({
  children,
  className = '',
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`text-xs font-medium text-ink-muted text-left py-2 px-3 border-b border-line sticky top-0 bg-surface ${className}`}
      {...props}
    >
      {children}
    </th>
  );
}

export interface TRProps extends React.HTMLAttributes<HTMLTableRowElement> {
  interactive?: boolean;
}

export function TR({
  children,
  interactive,
  className = '',
  ...props
}: TRProps) {
  return (
    <tr
      className={`border-b border-line last:border-b-0 ${interactive ? 'hover:bg-canvas' : ''} ${className}`}
      {...props}
    >
      {children}
    </tr>
  );
}

export function TD({
  children,
  className = '',
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`py-2 px-3 align-top text-sm text-ink ${className}`} {...props}>
      {children}
    </td>
  );
}

export interface EmptyRowProps {
  colSpan: number;
  children: React.ReactNode;
  className?: string;
}

export function EmptyRow({ colSpan, children, className = '' }: EmptyRowProps) {
  return (
    <tr>
      <td colSpan={colSpan} className={`py-8 text-center text-sm text-ink-muted ${className}`}>
        {children}
      </td>
    </tr>
  );
}
