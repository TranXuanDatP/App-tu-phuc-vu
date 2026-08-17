import {
  Controller,
  Post,
  Get,
  Body,
  Inject,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PortHttpClient } from '@shared/port/port-http-client.service';
import { PortRegistry } from '@shared/port';
import { eq, and } from 'drizzle-orm';
import { type DrizzleDB } from '@shared';
import { DATABASE_WRITE_TOKEN } from '@core/constants/tokens';
import { usersTable } from '../persistence/drizzle/schema/user.schema';
import { customerBindingsTable } from '../../../binding/infrastructure/persistence/drizzle/schema/binding.schema';
import { PII_ENCRYPTION_SERVICE_TOKEN } from '../../constants/tokens';
import { PiiEncryptionService } from '../persistence/encryption/pii-encryption.service';
import type { CustomerProfileResponse } from '../../../account/dto/customer-profile.dto';
import {
  RegisterProviderSchema,  LinkProviderSchema,
} from '../../application/dtos/register-provider.dto';
import { ValidationException } from '@core/common';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Public } from '../decorators/public.decorator';
// Handler-level @SkipBindingVerified on onboarding/identity routes (getMe,
// check-registration, link/unlink-provider) — they're polled/called right after OTP,
// before any bind exists, so the global deny-by-default guard must skip them (else
// poll → 403 → redirect bind → /me → 403 = dead loop). NOT applied to link-customer:
// that legacy phone/maKh → full-profile path bypasses the bill-secret proof binding
// requires, so it stays gated (403) — use the bind flow instead.
import { SkipBindingVerified } from '../../../binding/decorators/skip-binding-verified.decorator';
import {
  SwaggerRegisterProviderDto,
  SwaggerLinkProviderDto,
  SwaggerProviderCallbackResponseDto,
  SwaggerLinkProviderResponseDto,
  SwaggerAuthResponseDto,
} from '../../application/dtos/auth-swagger.dto';
import type {
  RegisterProviderDto,
  LinkProviderDto,
} from '../../application/dtos/register-provider.dto';
// NOTE: Provider linking (Zalo/Google/Facebook/Apple) is handled by better-auth's
// OAuth flow — the BFF issues the authorization URL and better-auth links the
// provider to the authenticated user on callback (/api/auth/callback/*). The BFF
// does not write provider links directly; better-auth owns the provider_links table.

/**
 * Auth Controller
 *
 * Thin REST endpoints for authentication flows.
 * better-auth handles its own routes at /api/auth/* (see BetterAuthController).
 * This controller:
 *   1. Validates input via Zod schemas
 *   2. Delegates auth operations to better-auth
 *   3. Syncs customer data to Backend API via PortHttpClient
 */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly customerServiceUrl?: string;

  constructor(
    private readonly portHttpClient: PortHttpClient,
    private readonly portRegistry: PortRegistry,
    @Inject(DATABASE_WRITE_TOKEN) private readonly db: DrizzleDB,
    private readonly config: ConfigService,
    @Inject(PII_ENCRYPTION_SERVICE_TOKEN) private readonly pii: PiiEncryptionService,
  ) {
    // Gate: when CUSTOMER_SERVICE_URL is set, check-registration calls the real
    // customer service to resolve phone → customerId. When unset → mock (current
    // seed phones + app-registered). Mock stays the source of truth for dev/test.
    this.customerServiceUrl = this.config.get<string>('CUSTOMER_SERVICE_URL') || undefined;
  }

  /**
   * POST /auth/provider/callback
   * Handle OAuth provider callback (Zalo, Google, Facebook, Apple).
   * better-auth handles the actual OAuth flow — this endpoint validates
   * and syncs to Backend API.
   * AC#2, AC#3
   */
  @Public()
  @Post('provider/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle OAuth provider callback (Zalo, Google, Facebook, Apple)' })
  @ApiBody({ type: SwaggerRegisterProviderDto })
  @ApiResponse({ status: 200, type: SwaggerProviderCallbackResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async providerCallback(@Body() body: RegisterProviderDto) {
    const parsed = RegisterProviderSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }

    this.logger.log(`Provider callback: ${parsed.data.providerType}`);

    // OAuth flow is handled by better-auth's social/genericOAuth plugins.
    // The provider is linked to the authenticated user on the OAuth callback.
    return {
      message: `Provider ${parsed.data.providerType} validated. OAuth flow handled by better-auth.`,
      providerType: parsed.data.providerType,
    };
  }

  /**
   * POST /auth/link-provider
   * Link additional provider to the AUTHENTICATED user.
   * Requires valid session — userId is extracted from session, NOT from body.
   * Delegates to Backend API for the actual linking.
   * AC#4
   */
  @SkipBindingVerified()
  @Post('link-provider')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Link additional OAuth provider to authenticated user' })
  @ApiBody({ type: SwaggerLinkProviderDto })
  @ApiResponse({ status: 200, type: SwaggerLinkProviderResponseDto })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async linkProvider(
    @CurrentUser('id') userId: string,
    @Body() body: LinkProviderDto,
  ) {

    const parsed = LinkProviderSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }

    this.logger.log(`Link provider ${parsed.data.providerType} to user ${this.pii.hashForLog(userId)}`);

    // Provider linking is performed by better-auth's OAuth flow: the App redirects the
    // user to the provider's authorization URL, and better-auth links the provider to
    // this authenticated user on callback (/api/auth/callback/*). The BFF does not
    // write provider links directly — better-auth owns the provider_links table.
    return {
      userId,
      providerType: parsed.data.providerType,
      message: `Open ${parsed.data.providerType} authorization via better-auth /api/auth/sign-in/social to link this provider to your account.`,
    };
  }

  /**
   * POST /auth/unlink-provider
   * Unlink a provider from the AUTHENTICATED user.
   * Delegates to better-auth's account-unlink API.
   */
  @SkipBindingVerified()
  @Post('unlink-provider')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Unlink an OAuth provider from the authenticated user' })
  @ApiResponse({ status: 200, description: 'Provider unlink request validated' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  async unlinkProvider(
    @CurrentUser('id') userId: string,
    @Body() body: LinkProviderDto,
  ) {
    const parsed = LinkProviderSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }

    this.logger.log(`Unlink provider ${parsed.data.providerType} from user ${this.pii.hashForLog(userId)}`);

    // better-auth exposes account unlink via its API; the App calls better-auth directly.
    return {
      userId,
      providerType: parsed.data.providerType,
      message: `Use better-auth to unlink ${parsed.data.providerType} from your account.`,
    };
  }

  /**
   * GET /auth/me
   * Get current authenticated user profile + identity status.
   * The mobile app polls this after OTP to decide routing:
   *   profileStatus 'complete' → dashboard; 'no_match' → complete-profile screen.
   * NOTE: never returns the CCCD value — only `hasCccd` boolean.
   */
  @SkipBindingVerified()
  @Get('me')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current authenticated user profile + identity status' })
  @ApiResponse({ status: 200, type: SwaggerAuthResponseDto })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  async getMe(@CurrentUser('id') userId: string) {
    const rows = await this.db
      .select({
        userId: usersTable.id,
        fullName: usersTable.fullName,
        cccd: usersTable.cccd,
        profileStatus: usersTable.profileStatus,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    const user = rows[0];

    // Single-source: `linked` + `customerId` both derive from the verified binding row
    // (customer_bindings.status='verified'), NOT the legacy users.customerId column (set by
    // check-registration phone-match, bypassing bill-secret proof). customerId is decrypted from
    // the binding cipher (same path as BindingVerifiedGuard) — null when no binding.
    const bindingRows = await this.db
      .select({
        id: customerBindingsTable.id,
        customerIdCipher: customerBindingsTable.customerId,
      })
      .from(customerBindingsTable)
      .where(
        and(
          eq(customerBindingsTable.userId, userId),
          eq(customerBindingsTable.status, 'verified'),
        ),
      )
      .limit(1);
    const linked = bindingRows.length > 0;
    const customerId = this.pii.decryptIfNeeded(bindingRows[0]?.customerIdCipher ?? null);

    if (!user) {
      return {
        userId,
        profileStatus: 'incomplete' as const,
        fullName: null,
        hasCccd: false,
        customerId,
        linked,
      };
    }

    return {
      userId,
      profileStatus: user.profileStatus ?? 'incomplete',
      fullName: user.fullName,
      hasCccd: !!user.cccd,
      customerId,
      linked,
    };
  }

  // POST /auth/register moved to BindingController (register = new-customer branch of the
  // unified bind flow, resolve-gated — SPEC-binding §4). AuthController can't inject
  // BindingService (BindingModule imports AuthModule for the PII token → DI cycle), so the
  // endpoint lives in BindingController at the same /auth prefix.

  /**
   * POST /auth/check-registration
   * Match the authenticated user against Customer 360 by phone — called by the
   * mobile app right after OTP to decide routing: a matched (existing) customer
   * goes straight to the dashboard; an unmatched user is shown the
   * "Bạn chưa đăng ký tài khoản" screen. On a match, links the customer and sets
   * profile_status='complete' so the limited-mode gate opens.
   *
   * Synchronous stand-in for the async (RabbitMQ) identity-resolution event path
   * — same port method (`customer-profile find-by-phone`).
   */
  @SkipBindingVerified()
  @Post('check-registration')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Match user against Customer 360 by phone (post-OTP routing)' })
  @ApiResponse({ status: 200, description: 'Whether the user is registered' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  async checkRegistration(@CurrentUser('id') userId: string) {
    const userRows = await this.db
      .select({ phoneNumber: usersTable.phoneNumber })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    const phone = userRows[0]?.phoneNumber ?? null;

    if (!phone) {
      return { registered: false, profileStatus: 'incomplete' as const };
    }

    // Wire: when CUSTOMER_SERVICE_URL is set, resolve phone against the REAL
    // customer service. When unset → mock (seed phones + app-registered via PortRegistry).
    const customer = this.customerServiceUrl
      ? await this.resolveFromCustomerService(phone)
      : await this.resolveFromMock(phone);

    if (customer) {
      await this.db
        .update(usersTable)
        .set({
          profileStatus: 'complete',
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, userId));
      // customerId KHÔNG vào log (plaintext id); user dạng hash (PII log remediation).
      this.logger.log(
        `check-registration: matched customer for user ${this.pii.hashForLog(userId)}`,
      );
      return {
        registered: true,
        profileStatus: 'complete' as const,
        customerId: customer.customerId,
      };
    }

    return { registered: false, profileStatus: 'incomplete' as const };
  }

  /**
   * Resolve phone → customer via the real customer service (CUSTOMER_SERVICE_URL).
   * W0 safe-default: 0 match → null, 1 match → return, N match → DENY (null).
   * Pick-first on N match is a data-leak risk (one phone → multiple contracts,
   * household multi-meter). Disambiguation deferred to W1 binding challenge.
   */
  private async resolveFromCustomerService(
    phone: string,
  ): Promise<CustomerProfileResponse | null> {
    try {
      const res = await fetch(
        `${this.customerServiceUrl}/api/v1/customers/resolve?phone=${encodeURIComponent(phone)}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) {
        this.logger.warn(
          `customer-service resolve returned ${res.status} for phone ${phone.slice(-4)}`,
        );
        return null;
      }
      const json = (await res.json()) as {
        data?: CustomerProfileResponse | CustomerProfileResponse[];
      };
      const data = json?.data;
      if (!data) return null;

      // W0: N-match → DENY (null). Pick-first is a data-leak risk (household
      // multi-meter). Disambiguation deferred to W1 binding challenge.
      if (Array.isArray(data)) {
        if (data.length === 0) return null;
        if (data.length > 1) {
          this.logger.warn(
            `phone ${phone.slice(-4)} resolved to ${data.length} customers — DENYING (multi-match). Disambiguation required.`,
          );
          return null;
        }
        return data[0];
      }
      return data;
    } catch (err) {
      this.logger.error(
        `customer-service resolve failed for phone ${phone.slice(-4)}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Resolve phone → customer via the mock adapter (PortRegistry). Used in dev/test
   * when CUSTOMER_SERVICE_URL is unset. Seed phones (0901234567, 0987654321) +
   * app-registered customers (via create-customer).
   */
  private async resolveFromMock(
    phone: string,
  ): Promise<CustomerProfileResponse | null> {
    try {
      const result = await this.portRegistry.execute<CustomerProfileResponse | null>(
        'customer-profile',
        'find-by-phone',
        { phone },
      );
      return result?.data ?? null;
    } catch (err) {
      this.logger.warn(
        `mock find-by-phone failed: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
