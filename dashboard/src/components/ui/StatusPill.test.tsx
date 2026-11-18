import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill } from './StatusPill';

describe('StatusPill', () => {
  it('renders text with the tone class', () => {
    render(<StatusPill tone="ok">Hoạt động</StatusPill>);
    const pill = screen.getByText('Hoạt động');
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveClass('bg-ok-tint', 'text-ok');
  });

  it('renders all tones with their respective classes', () => {
    const { rerender } = render(<StatusPill tone="warn">Cảnh báo</StatusPill>);
    expect(screen.getByText('Cảnh báo')).toHaveClass('bg-warn-tint', 'text-warn');

    rerender(<StatusPill tone="danger">Lỗi</StatusPill>);
    expect(screen.getByText('Lỗi')).toHaveClass('bg-danger-tint', 'text-danger');

    rerender(<StatusPill tone="info">Thông tin</StatusPill>);
    expect(screen.getByText('Thông tin')).toHaveClass('bg-accent-tint', 'text-accent');

    rerender(<StatusPill tone="neutral">Chưa rõ</StatusPill>);
    expect(screen.getByText('Chưa rõ')).toHaveClass('bg-canvas', 'text-ink-muted');
  });
});
