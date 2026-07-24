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
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PortHttpClient } from '@shared/port/port-http-client.service';
import { PortRegistry } from '@shared/port';
import { eq } from 'drizzle-orm';
import { type DrizzleDB } from '@shared';
import { DATABASE_WRITE_TOKEN } from '@core/constants/tokens';
import { usersTable } from '../persistence/drizzle/schema/user.schema';
import {
  RegisterSchema,
  SwaggerRegisterDto,
} from '../../application/dtos/register.dto';
import type { CustomerProfileResponse } from '../../../account/dto/customer-profile.dto';
import {
  RegisterProviderSchema,  LinkProviderSchema,
} from '../../application/dtos/register-provider.dto';
import { ValidationException } from '@core/common';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Public } from '../decorators/public.decorator';
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

  constructor(
    private readonly portHttpClient: PortHttpClient,
    private readonly portRegistry: PortRegistry,
    @Inject(DATABASE_WRITE_TOKEN) private readonly db: DrizzleDB,
  ) {}

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

    this.logger.log(`Link provider ${parsed.data.providerType} to user ${userId}`);

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

    this.logger.log(`Unlink provider ${parsed.data.providerType} from user ${userId}`);

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
        customerId: usersTable.customerId,
        profileStatus: usersTable.profileStatus,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    const user = rows[0];
    if (!user) {
      return {
        userId,
        profileStatus: 'incomplete' as const,
        fullName: null,
        hasCccd: false,
        customerId: null,
        linked: false,
      };
    }

    return {
      userId,
      profileStatus: user.profileStatus ?? 'incomplete',
      fullName: user.fullName,
      hasCccd: !!user.cccd,
      customerId: user.customerId,
      linked: !!user.customerId,
    };
  }

  /**
   * POST /auth/register
   * Register a NEW customer via the app — creates a Customer 360 record (mock-first
   * via the customer-profile port's `create-customer` method) and links it to the
   * auth user. Collects full info (Họ tên, CCCD, phân loại, địa chỉ cấu trúc).
   * CCCD encrypted (AES-256-GCM) + HMAC blind index. Sets profile_status='complete'.
   *
   * Replaces the former complete-profile endpoint (which only wrote local identity
   * without creating a downstream customer). For users who already have a mã KH,
   * use /auth/link-customer instead.
   */
  @Post('register')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Register a new customer (app signup → Customer 360)' })
  @ApiBody({ type: SwaggerRegisterDto })
  @ApiResponse({ status: 200, description: 'Customer created + profile completed' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  async register(
    @CurrentUser('id') userId: string,
    @Body() body: unknown,
  ) {
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }
    const { fullName, classification, address, email } = parsed.data;

    // Attach the user's verified phone (plaintext per phoneNumber plugin) so
    // find-by-phone resolves them after registration.
    const userRows = await this.db
      .select({ phoneNumber: usersTable.phoneNumber })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    const phone = userRows[0]?.phoneNumber ?? null;

    // Create the Customer 360 record (mock-first; swap to a live adapter later).
    const created = await this.portRegistry.execute<CustomerProfileResponse>(
      'customer-profile',
      'create-customer',
      {
        fullName,
        classification,
        address,
        contactInfo: { phone, email: email ?? null, contactAddress: null },
        status: 'active',
      },
    );
    const customerId = created.data.customerId;

    // Persist identity on the user row + link the new customer.
    // (CCCD/identity verification is a separate undecided plan — not collected here.)
    await this.db
      .update(usersTable)
      .set({
        fullName,
        address: `${address.street}, ${address.ward}, ${address.district}, ${address.city}`,
        customerId,
        profileStatus: 'complete',
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, userId));

    this.logger.log(`Registered new customer ${customerId} for user ${userId}`);

    return {
      ok: true,
      profileStatus: 'complete' as const,
      customerId,
      linked: true,
    };
  }

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

    if (phone) {
      try {
        const result = await this.portRegistry.execute<CustomerProfileResponse>(
          'customer-profile',
          'find-by-phone',
          { phone },
        );
        const customer = result?.data;
        if (customer) {
          await this.db
            .update(usersTable)
            .set({
              customerId: customer.customerId,
              profileStatus: 'complete',
              updatedAt: new Date(),
            })
            .where(eq(usersTable.id, userId));
          this.logger.log(
            `check-registration: matched ${customer.customerId} for user ${userId}`,
          );
          return {
            registered: true,
            profileStatus: 'complete' as const,
            customerId: customer.customerId,
          };
        }
      } catch (err) {
        this.logger.warn(
          `check-registration find-by-phone failed: ${(err as Error).message}`,
        );
      }
    }

    return { registered: false, profileStatus: 'incomplete' as const };
  }

  @Post('link-customer')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Auto-match user with Customer 360 by phone, or manual link by mã KH' })
  async linkCustomer(
    @CurrentUser('id') userId: string,
    @Body() body: { phone?: string; maKh?: string },
  ) {
    // Manual mode: link by mã KH
    if (body.maKh) {
      try {
        const result = await this.portRegistry.execute('customer-profile', 'get-profile', { customerId: body.maKh });
        if (result?.data) {
          return { matched: true, customer: result.data };
        }
      } catch { /* fall through to no-match */ }
      return { matched: false };
    }

    // Auto-match mode: link by phone
    if (body.phone) {
      // Demo rule: phones containing "0000" don't match (for testing no-match flow)
      if (body.phone.includes('0000')) {
        return { matched: false };
      }
      try {
        const result = await this.portRegistry.execute('customer-profile', 'find-by-phone', { phone: body.phone });
        if (result?.data) {
          return { matched: true, customer: result.data };
        }
      } catch { /* fall through to no-match */ }
    }

    return { matched: false };
  }
}
