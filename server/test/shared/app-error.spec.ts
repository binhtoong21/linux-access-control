import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { AppError, toErrorResponse, validationDetails } from '../../src/shared/http/app-error';

describe('toErrorResponse', () => {
  it('maps an AppError to its fixed status and keeps details', () => {
    expect(toErrorResponse(new AppError('LAST_ACTIVE_ADMIN', 'last one', [{ id: 'x' }]))).toEqual({
      status: 409,
      body: { error: { code: 'LAST_ACTIVE_ADMIN', message: 'last one', details: [{ id: 'x' }] } },
    });
  });

  it('omits empty details', () => {
    expect(toErrorResponse(new AppError('NOT_FOUND', 'missing', [])).body).toEqual({
      error: { code: 'NOT_FOUND', message: 'missing' },
    });
  });

  it('maps framework HTTP exceptions by status', () => {
    expect(toErrorResponse(new NotFoundException()).body.error.code).toBe('NOT_FOUND');
    expect(toErrorResponse(new BadRequestException()).body.error.code).toBe('VALIDATION_ERROR');
    expect(toErrorResponse(new PayloadTooLargeException())).toMatchObject({
      status: 413,
      body: { error: { code: 'HTTP_ERROR' } },
    });
  });

  it('hides unexpected errors behind a generic 500', () => {
    expect(toErrorResponse(new Error('password authentication failed for user nfclab'))).toEqual({
      status: 500,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
    });
  });
});

describe('validationDetails', () => {
  it('flattens nested errors with dotted paths', () => {
    const details = validationDetails([
      { property: 'username', constraints: { isNotEmpty: 'username should not be empty' }, children: [] },
      { property: 'profile', children: [{ property: 'name', constraints: { maxLength: 'too long' }, children: [] }] },
    ]);
    expect(details).toEqual([
      { field: 'username', constraints: ['username should not be empty'] },
      { field: 'profile.name', constraints: ['too long'] },
    ]);
  });
});
