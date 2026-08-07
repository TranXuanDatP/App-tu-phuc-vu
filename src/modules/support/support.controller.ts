/**
 * Support controller — REST endpoints for call center (route prefix /call-center
 * preserved for FE contract). Thin: route + auth → delegates to SupportService.
 */
import { SkipBindingVerified } from '@modules/binding/decorators/skip-binding-verified.decorator';
import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/infrastructure/decorators/current-user.decorator';
import { SupportService } from './support.service';

@ApiTags('Call Center')
@ApiBearerAuth('JWT-auth')
@SkipBindingVerified()
@Controller('call-center')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('click-to-call')
  @ApiOperation({ summary: 'Initiate a click-to-call from App to hotline' })
  clickToCall(@CurrentUser('id') userId: string, @Body() body: unknown) {
    return this.supportService.createClickToCall(userId, body);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get call history for the current customer' })
  history(@CurrentUser('id') userId: string) {
    return this.supportService.getCallHistory(userId);
  }

  @Post('message')
  @ApiOperation({ summary: 'Send chat message to CSKH (forwarded to omnichannel inbox)' })
  message(@CurrentUser('id') userId: string, @Body() body: { text: string }) {
    return this.supportService.sendMessage(userId, body?.text ?? '');
  }

  @Get('messages')
  @ApiOperation({ summary: 'Get the customer chat thread (history + staff replies)' })
  messages(@CurrentUser('id') userId: string) {
    return this.supportService.getConversation(userId);
  }
}
