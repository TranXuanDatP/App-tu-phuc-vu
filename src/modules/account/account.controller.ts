/**
 * Account controller — REST endpoints for customer profile (route prefix /customers
 * preserved for FE contract). Thin: route + auth → delegates to AccountService.
 */
import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/infrastructure/decorators/current-user.decorator';
import { RequiresBinding } from '../binding/decorators/requires-binding.decorator';
import { AccountService } from './account.service';

@ApiTags('Customer')
@ApiBearerAuth('JWT-auth')
@RequiresBinding()
@Controller('customers')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get customer 360° profile' })
  getProfile(@CurrentUser('id') userId: string) {
    return this.accountService.getProfile(userId);
  }

  @Get('timeline')
  @ApiOperation({ summary: 'Get customer interaction timeline' })
  getTimeline(@CurrentUser('id') userId: string) {
    return this.accountService.getTimeline(userId);
  }

  @Get('related-accounts')
  @ApiOperation({ summary: 'Get related accounts (KCN relationship tree)' })
  getRelatedAccounts(@CurrentUser('id') userId: string) {
    return this.accountService.getRelatedAccounts(userId);
  }

  @Put('profile')
  @ApiOperation({ summary: 'Update customer contact info' })
  updateProfile(@CurrentUser('id') userId: string, @Body() body: unknown) {
    return this.accountService.updateProfile(userId, body);
  }
}

/**
 * Onboarding controller — REST endpoints for new connection signup
 * (route prefix /onboarding preserved for FE contract). Thin: route + auth →
 * delegates to AccountService. Folded from the former OnboardingModule.
 */
@ApiTags('Onboarding')
@ApiBearerAuth('JWT-auth')
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly accountService: AccountService) {}

  @Post()
  @ApiOperation({ summary: 'Create onboarding (new connection) request' })
  create(@CurrentUser('id') userId: string, @Body() body: unknown) {
    return this.accountService.createOnboardingRequest(userId, body);
  }

  @Get(':requestId')
  @ApiOperation({ summary: 'Get onboarding request status' })
  status(@Param('requestId') requestId: string) {
    return this.accountService.getOnboardingStatus(requestId);
  }

  @Post(':requestId/documents')
  @ApiOperation({ summary: 'Submit documents for an onboarding request' })
  submitDocuments(
    @CurrentUser('id') userId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
  ) {
    return this.accountService.submitDocuments(requestId, userId, body);
  }
}
