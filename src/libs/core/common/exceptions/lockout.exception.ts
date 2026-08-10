import { BaseException } from './base.exception';

/**
 * Lockout Exception
 *
 * Thrown by the binding flow when a BindingRateLimiter brute-force ceiling is crossed
 * (user_ref / customer_ref / session tiers). HTTP 429 Too Many Requests.
 *
 * Carries `reason` + `retryAfterSec` in details so the client can show the RIGHT message
 * (your attempts vs cross-user abuse vs cross-ref session abuse) and a countdown. The
 * three reasons need distinct UX — a legitimately-locked customer (customer_ref tier,
 * locked because someone ELSE hammered their ref) must NOT be told "you entered wrong",
 * or they will re-enter the correct secret forever and fail.
 *
 * Extends BaseException (NOT HttpException) on purpose: the global filter's
 * handleBaseException path passes `code` + `details` through to the wire body, whereas
 * handleHttpException strips them — the mobile needs reason/retryAfterSec to branch UX.
 */
export class LockoutException extends BaseException {
  constructor(reason: string, retryAfterSec: number) {
    super(
      'Đã vượt số lần thử cho phép. Vui lòng thử lại sau.',
      'BINDING_LOCKED',
      { reason, retryAfterSec },
    );
  }
}
