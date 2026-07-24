/**
 * Billing module — lean BFF module (4-part: controller + service + dto + clients).
 * Registers both the tariff and invoice mock ports. No domain/, no CQRS handlers.
 *
 * Two ports, one module:
 *   - tariff (static cache, 12-24h)
 *   - invoice (dynamic cache, 5-15 min)
 */
import { Module, OnModuleInit } from '@nestjs/common';
import { PortRegistry } from '@shared/port';
import { TariffController, InvoiceController } from './billing.controller';
import { BillingService } from './billing.service';
import { MockTariffAdapter } from './clients/tariff.client';
import { MockInvoiceAdapter } from './clients/invoice.client';

@Module({
  controllers: [TariffController, InvoiceController],
  providers: [BillingService, MockTariffAdapter, MockInvoiceAdapter],
})
export class BillingModule implements OnModuleInit {
  constructor(
    private readonly portRegistry: PortRegistry,
    private readonly mockTariffAdapter: MockTariffAdapter,
    private readonly mockInvoiceAdapter: MockInvoiceAdapter,
  ) {}

  onModuleInit() {
    // Port 1: Tariff (static, 12-24h cache)
    this.portRegistry.register('tariff', this.mockTariffAdapter, this.mockTariffAdapter);
    // Port 2: Invoice (dynamic, 5-15 min cache)
    this.portRegistry.register('invoice', this.mockInvoiceAdapter, this.mockInvoiceAdapter);
  }
}
