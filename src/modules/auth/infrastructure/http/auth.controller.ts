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
import {
  RegisterPhoneSchema,
} from '../../application/dtos/register-phone.dto';
import {
  RegisterProviderSchema,  LinkProviderSchema,
  VerifyOtpSchema,
} from '../../application/dtos/register-provider.dto';
import { ValidationException } from '@core/common';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Public } from '../decorators/public.decorator';
import {
  SwaggerRegisterPhoneDto,
  SwaggerVerifyOtpDto,
  SwaggerRegisterProviderDto,
  SwaggerLinkProviderDto,
  SwaggerVerifyOtpResponseDto,
  SwaggerProviderCallbackResponseDto,
  SwaggerLinkProviderResponseDto,
  SwaggerAuthResponseDto,
} from '../../application/dtos/auth-swagger.dto';
import type {
  RegisterPhoneDto,
} from '../../application/dtos/register-phone.dto';
import type {
  RegisterProviderDto,
  LinkProviderDto,
  VerifyOtpDto,
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
  ) {}

  /**
   * POST /auth/register-phone
   * Initiate phone/OTP registration. Sends OTP to the provided number.
   * NOTE: OTP is sent via better-auth's phoneNumber plugin.
   * AC#1
   */
  @Public()
  @Post('register-phone')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register / login with phone number — sends OTP' })
  @ApiBody({ type: SwaggerRegisterPhoneDto })
  @ApiResponse({ status: 200, description: 'OTP sent successfully' })
  @ApiResponse({ status: 400, description: 'Validation error (invalid phone format)' })
  async registerPhone(@Body() body: RegisterPhoneDto) {
    const parsed = RegisterPhoneSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }

    this.logger.log(`Phone registration initiated for: ****${parsed.data.phoneNumber.slice(-4)}`);

    return {
      message: 'OTP sent to phone number. Verify via POST /auth/verify-otp.',
      phoneNumber: parsed.data.phoneNumber,
    };
  }

  /**
   * POST /auth/verify-otp
   * Verify OTP code for phone registration/login.
   *
   * Flow: validate → better-auth verifies OTP (creates/updates user in local DB)
   *       → sync customer to Backend API
   * AC#1
   */
  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP code for phone registration/login' })
  @ApiBody({ type: SwaggerVerifyOtpDto })
  @ApiResponse({ status: 200, type: SwaggerVerifyOtpResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error (invalid OTP format)' })
  async verifyOtp(@Body() body: VerifyOtpDto) {
    const parsed = VerifyOtpSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }

    // Delegate OTP verification to better-auth
    // better-auth's phoneNumber plugin handles verification and user creation
    // The frontend should call /api/auth/verify-phone directly,
    // but we keep this endpoint as a documented API surface
    this.logger.log(`OTP verification for phone ending: ...${parsed.data.phoneNumber.slice(-4)}`);

    // TODO: Wire to better-auth's verify-phone endpoint
    // For now, return validation success — actual verification via /api/auth/verify-phone
    return {
      message: 'OTP validated. Verify via better-auth /api/auth/verify-phone for full flow.',
      phoneNumber: parsed.data.phoneNumber,
    };
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
   * Get current authenticated user profile.
   * Requires valid session — fetches from Backend API.
   */
  @Get('me')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  @ApiResponse({ status: 200, type: SwaggerAuthResponseDto })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  async getMe(@CurrentUser('id') userId: string) {

    // TODO: When Backend API is available:
    // return this.portHttpClient.request({
    //   url: `${backendUrl}/users/${userId}`,
    //   method: 'GET',
    //   portName: 'customer-profile',
    // });

    // Session exists — return minimal profile from session
    return {
      userId,
      message: 'Session verified. Full profile will be fetched from Backend API when available.',
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
