/**
 * Support module — lean BFF module (4-part: controller + service + dto + clients).
 * Registers the call-center mock port (port name preserved). No domain/, no CQRS
 * handlers. Renamed from CallCenterModule; route prefix /call-center unchanged.
 */
import { Module, OnModuleInit } from '@nestjs/common';
import { PortRegistry } from '@shared/port';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { MockCallCenterAdapter } from './clients/call-center.client';
import { CskhChatAdapter } from './clients/cskh-chat.client';
import { ChatOutboxForwarder } from './chat-outbox.forwarder';

@Module({
  controllers: [SupportController],
  providers: [SupportService, ChatOutboxForwarder, MockCallCenterAdapter, CskhChatAdapter],
})
export class SupportModule implements OnModuleInit {
  constructor(
    private readonly portRegistry: PortRegistry,
    private readonly mockAdapter: MockCallCenterAdapter,
    private readonly cskhChatAdapter: CskhChatAdapter,
  ) {}

  onModuleInit() {
    this.portRegistry.register('call-center', this.mockAdapter, this.mockAdapter);
    // Customer chat (app) → CSKH inbox (omichannel_be /webhooks/app), config-gated by CSKH_WEBHOOK_URL
    this.portRegistry.register('cskh-chat', this.cskhChatAdapter, this.cskhChatAdapter);
  }
}
