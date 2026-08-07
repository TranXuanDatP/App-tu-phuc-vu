/**
 * BindingController — bind-init / bind endpoints (A1.3).
 *
 * Mounted at /auth so the mobile hits POST /auth/bind-init and POST /auth/bind (per
 * SPEC-A4-A1 §A1.3). Authenticated (SessionAuthGuard), but NOT @RequiresBinding —
 * binding is exactly how you GET a verified binding, so it must be reachable before one
 * exists. The session-scoping + foreign-ref rejection lives in BindingService (Fix 1).
 */
import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody, ApiResponse } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/infrastructure/decorators/current-user.decorator';
import { ValidationException } from '@core/common';
import {
  RegisterSchema,
  SwaggerRegisterDto,
} from '@modules/auth/application/dtos/register.dto';
import { BindingService } from './binding.service';
import { BindSchema } from './dto/bind.dto';

@ApiTags('Auth')
@ApiBearerAuth('JWT-auth')
@Controller('auth')
export class BindingController {
  constructor(private readonly bindingService: BindingService) {}

  /**
   * POST /auth/bind-init
   * Resolve the OTP-verified SESSION phone → masked candidates. No body (Fix 1: phone
   * is server-side). Returns {status:'none'|'one'|'many', ...} — 'none' → client routes
   * to register; 'one'/'many' → user picks a candidate, then POST /auth/bind.
   */
  @Post('bind-init')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start customer binding (resolve session phone → candidates)' })
  @ApiResponse({ status: 200, description: 'Resolve result with masked candidates' })
  async bindInit(
    @CurrentUser('id') userId: string,
    @CurrentUser('sessionId') sessionId: string,
  ) {
    return this.bindingService.bindInit(userId, sessionId);
  }

  /**
   * POST /auth/bind
   * Verify a bill-secret for a customerRef that came from THIS session's bind-init.
   * Fix 1: free-form/foreign customerRef → 400. On verify=true the binding is written
   * (customerId encrypted at rest). On failure → {bound:false}; after the dual-ceiling
   * threshold → 429 BINDING_LOCKED.
   */
  @Post('bind')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a bill-secret and bind the customer (session-scoped)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['customerRef', 'secretType', 'secretValue'],
      properties: {
        customerRef: { type: 'string', description: 'From bind-init of THIS session' },
        secretType: { type: 'string', enum: ['last_invoice_amount', 'ma_kh'] },
        secretValue: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 200, description: '{bound:boolean, customerId?:string}' })
  @ApiResponse({ status: 400, description: 'Validation error / foreign customerRef / expired init' })
  @ApiResponse({ status: 429, description: 'BINDING_LOCKED — dual-ceiling lockout' })
  async bind(
    @CurrentUser('id') userId: string,
    @CurrentUser('sessionId') sessionId: string,
    @Body() body: unknown,
    @Headers('x-device-id') deviceHeader?: string,
  ) {
    const parsed = BindSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }
    return this.bindingService.bind(
      userId,
      sessionId,
      parsed.data,
      deviceHeader ?? null,
    );
  }

  /**
   * POST /auth/register
   * NEW-CUSTOMER branch of the unified bind flow (resolve-gated, SPEC-binding §4). Called
   * when bind-init resolve returned 'none'. Creates Customer 360 + auto verified binding
   * (creation = proof). TWO reject points: (1) re-resolve finds existing → 409 reroute
   * bind; (2) create conflict (race tail) → 409 reroute bind, never auto-bind.
   */
  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Register new customer + bind (new-customer branch, resolve-gated)' })
  @ApiBody({ type: SwaggerRegisterDto })
  @ApiResponse({ status: 200, description: '{bound:boolean, customerId?:string}' })
  @ApiResponse({ status: 409, description: 'CUSTOMER_EXISTS_USE_BIND — use /auth/bind instead' })
  async register(
    @CurrentUser('id') userId: string,
    @CurrentUser('sessionId') sessionId: string,
    @Body() body: unknown,
    @Headers('x-device-id') deviceHeader?: string,
  ) {
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }
    const { fullName, classification, address, email } = parsed.data;
    return this.bindingService.bindRegister(
      userId,
      sessionId,
      { fullName, classification, address, email: email ?? null },
      deviceHeader ?? null,
    );
  }
}
