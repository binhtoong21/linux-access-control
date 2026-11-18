import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field, fieldDescribedBy } from './Field';

describe('Field', () => {
  it('associates label with the control', () => {
    render(
      <Field label="Họ và tên" htmlFor="fullname">
        <input id="fullname" type="text" />
      </Field>,
    );
    expect(screen.getByLabelText('Họ và tên')).toHaveAttribute('id', 'fullname');
  });

  it('renders hint and error with role="alert"', () => {
    render(
      <Field
        label="Email"
        htmlFor="email"
        hint="Nhập email trường"
        error="Email không hợp lệ"
      >
        <input id="email" type="email" />
      </Field>,
    );
    expect(screen.getByText('Nhập email trường')).toHaveAttribute('id', 'email-hint');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Email không hợp lệ');
    expect(alert).toHaveAttribute('id', 'email-error');
  });

  it('fieldDescribedBy returns expected IDs', () => {
    expect(fieldDescribedBy('field1', { hint: 'Hint', error: 'Error' })).toBe(
      'field1-hint field1-error',
    );
    expect(fieldDescribedBy('field2', { hint: 'Hint' })).toBe('field2-hint');
    expect(fieldDescribedBy('field3', { error: 'Error' })).toBe('field3-error');
    expect(fieldDescribedBy('field4', {})).toBeUndefined();
  });
});
