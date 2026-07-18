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
import { PII_ENCRYPTION_SERVICE_TOKEN } from '../../constants/tokens';
import { PiiEncryptionService } from '../persistence/encryption/pii-encryption.service';
import { usersTable } from '../persistence/drizzle/schema/user.schema';
import {
  CompleteProfileSchema,
  SwaggerCompleteProfileDto,
} from '../../application/dtos/complete-profile.dto';
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
    @Inject(PII_ENCRYPTION_SERVICE_TOKEN)
    private readonly piiEncryption: PiiEncryptionService,
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
   * POST /auth/complete-profile
   * Complete identity profile for a NEW user or one whose identity resolution
   * returned no Customer 360 match. Collects Họ tên, Địa chỉ, CCCD (+ optional
   * mã KH to link an existing customer). CCCD is encrypted (AES-256-GCM) with a
   * HMAC blind index. Sets profile_status='complete'.
   */
  @Post('complete-profile')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Complete identity profile (new user / no Customer 360 match)',
  })
  @ApiBody({ type: SwaggerCompleteProfileDto })
  @ApiResponse({ status: 200, description: 'Profile completed' })
  @ApiResponse({ status: 400, description: 'Validation error / invalid mã KH' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  async completeProfile(
    @CurrentUser('id') userId: string,
    @Body() body: unknown,
  ) {
    const parsed = CompleteProfileSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }
    const { fullName, address, cccd, maKh } = parsed.data;

    // Optional: link an existing Customer 360 record by mã KH.
    let linkedCustomerId: string | null = null;
    if (maKh) {
      try {
        const result = await this.portRegistry.execute(
          'customer-profile',
          'get-profile',
          { customerId: maKh },
        );
        if (!result?.data) {
          throw new ValidationException(
            `Mã khách hàng '${maKh}' không tồn tại`,
          );
        }
        linkedCustomerId =
          (result.data as { customerId?: string }).customerId ?? maKh;
      } catch (e) {
        if (e instanceof ValidationException) throw e;
        throw new ValidationException(
          `Không thể xác minh mã khách hàng '${maKh}'`,
        );
      }
    }

    // Persist identity. CCCD encrypted (AES-256-GCM) + HMAC blind index for dedup.
    await this.db
      .update(usersTable)
      .set({
        fullName,
        address,
        cccd: this.piiEncryption.encrypt(cccd),
        cccdHash: this.piiEncryption.hashForLookup(cccd),
        ...(linkedCustomerId ? { customerId: linkedCustomerId } : {}),
        profileStatus: 'complete',
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, userId));

    this.logger.log(
      `Profile completed for user ${userId} (linked=${!!linkedCustomerId})`,
    );

    return {
      ok: true,
      profileStatus: 'complete' as const,
      linked: !!linkedCustomerId,
      ...(linkedCustomerId ? { customerId: linkedCustomerId } : {}),
    };
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
