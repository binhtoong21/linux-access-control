import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog } from './Dialog';

describe('Dialog', () => {
  it('renders with role dialog and accessible name', () => {
    render(
      <Dialog open={true} onClose={vi.fn()} title="Tiêu đề hộp thoại" description="Mô tả">
        <p>Nội dung</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Tiêu đề hộp thoại' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Mô tả')).toBeInTheDocument();
  });

  it('moves focus inside on open', () => {
    render(
      <Dialog open={true} onClose={vi.fn()} title="Hộp thoại">
        <button>Nút 1</button>
        <button>Nút 2</button>
      </Dialog>,
    );
    expect(screen.getByRole('button', { name: 'Nút 1' })).toHaveFocus();
  });

  it('Tab from the last element wraps to the first and Shift+Tab wraps back', () => {
    render(
      <Dialog open={true} onClose={vi.fn()} title="Hộp thoại">
        <button>Nút 1</button>
        <button>Nút 2</button>
      </Dialog>,
    );
    const btn1 = screen.getByRole('button', { name: 'Nút 1' });
    const btn2 = screen.getByRole('button', { name: 'Nút 2' });

    btn2.focus();
    expect(btn2).toHaveFocus();

    // Tab from last element
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(btn1).toHaveFocus();

    // Shift+Tab from first element wraps to last
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(btn2).toHaveFocus();
  });

  it('Escape calls onClose', () => {
    const handleClose = vi.fn();
    render(
      <Dialog open={true} onClose={handleClose} title="Hộp thoại">
        <p>Nội dung</p>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('returns focus to opener after close', () => {
    function TestComponent() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setOpen(true)}>Mở dialog</button>
          <Dialog open={open} onClose={() => setOpen(false)} title="Hộp thoại">
            <button onClick={() => setOpen(false)}>Đóng</button>
          </Dialog>
        </div>
      );
    }

    render(<TestComponent />);
    const opener = screen.getByRole('button', { name: 'Mở dialog' });
    opener.focus();
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    const closeBtn = screen.getByRole('button', { name: 'Đóng' });
    expect(closeBtn).toHaveFocus();

    fireEvent.click(closeBtn);
    expect(opener).toHaveFocus();
  });

  it('overlay click does not close', () => {
    const handleClose = vi.fn();
    render(
      <Dialog open={true} onClose={handleClose} title="Hộp thoại">
        <p>Nội dung</p>
      </Dialog>,
    );
    const overlay = screen.getByTestId('dialog-overlay');
    fireEvent.click(overlay);
    expect(handleClose).not.toHaveBeenCalled();
  });
});
