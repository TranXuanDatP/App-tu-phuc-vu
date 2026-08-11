/**
 * GlobalExceptionFilter — BaseException pass-through contract.
 *
 * LockoutException extends BaseException (NOT HttpException) precisely so the filter's
 * handleBaseException path passes `code` + `details` to the wire body — the mobile reads
 * details.reason to pick the right lockout message + countdown. A raw HttpException would
 * have code/reason/retryAfter stripped. These tests pin that wire shape; if someone removes
 * the LockoutException→429 mapping in getHttpStatus, the status assertion fails.
 */
import { GlobalExceptionFilter } from '../../src/libs/shared/http/filters/global-exception.filter';
import { LockoutException, ConflictException } from '../../src/libs/core/common';

describe('GlobalExceptionFilter — BaseException pass-through', () => {
  let filter: GlobalExceptionFilter;
  let reply: { status: jest.Mock; send: jest.Mock };
  let host: any;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    reply = { status: jest.fn().mockReturnThis(), send: jest.fn() };
    host = {
      switchToHttp: () => ({
        getResponse: () => reply,
        getRequest: () => ({ url: '/auth/bind', method: 'POST' }),
      }),
    } as any;
  });

  it('LockoutException (session) → 429 with code + details.{reason, retryAfterSec}', () => {
    filter.catch(new LockoutException('session', 900), host);
    expect(reply.status).toHaveBeenCalledWith(429);
    const body = reply.send.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.statusCode).toBe(429);
    expect(body.error.code).toBe('BINDING_LOCKED');
    expect(body.error.details).toEqual({ reason: 'session', retryAfterSec: 900 });
  });

  it('LockoutException (customer_ref) → 429, cross-user reason passes through', () => {
    filter.catch(new LockoutException('customer_ref', 86400), host);
    expect(reply.status).toHaveBeenCalledWith(429);
    expect(reply.send.mock.calls[0][0].error.details).toEqual({
      reason: 'customer_ref',
      retryAfterSec: 86400,
    });
  });

  it('ConflictException parity still works (regression: LockoutException uses the same path)', () => {
    filter.catch(new ConflictException('m', 'CUSTOMER_EXISTS_USE_BIND', { status: 'one' }), host);
    expect(reply.status).toHaveBeenCalledWith(409);
    const body = reply.send.mock.calls[0][0];
    expect(body.error.code).toBe('CUSTOMER_EXISTS_USE_BIND');
    expect(body.error.details).toEqual({ status: 'one' });
  });
});
