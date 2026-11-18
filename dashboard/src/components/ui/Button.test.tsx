import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('defaults to type="button"', () => {
    render(<Button>Click me</Button>);
    const button = screen.getByRole('button', { name: 'Click me' });
    expect(button).toHaveAttribute('type', 'button');
  });

  it('loading disables button and shows "Đang xử lý…"', () => {
    render(<Button loading>Lưu</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Lưu Đang xử lý…');
  });

  it('renders primary variant with accent background and white text', () => {
    render(<Button variant="primary">Lưu</Button>);
    const button = screen.getByRole('button', { name: 'Lưu' });
    expect(button).toHaveClass('bg-accent', 'text-white');
  });
});
