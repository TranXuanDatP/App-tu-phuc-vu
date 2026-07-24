/**
 * ServiceRequest module — lean BFF module (4-part: controller + service + dto +
 * clients). Merges the former contract + econtract modules. Registers both the
 * contract and econtract mock ports. No domain/, no CQRS handlers.
 *
 * Two ports, one module:
 *   - contract (contracts list/detail/versions/pdf)
 *   - econtract (digital contract retrieval + e-signature)
 */
import { Module, OnModuleInit } from '@nestjs/common';
import { PortRegistry } from '@shared/port';
import { ContractController, EcontractController } from './service-request.controller';
import { ServiceRequestService } from './service-request.service';
import { MockContractAdapter } from './clients/contract.client';
import { MockEcontractAdapter } from './clients/econtract.client';

@Module({
  controllers: [ContractController, EcontractController],
  providers: [ServiceRequestService, MockContractAdapter, MockEcontractAdapter],
})
export class ServiceRequestModule implements OnModuleInit {
  constructor(
    private readonly portRegistry: PortRegistry,
    private readonly mockContractAdapter: MockContractAdapter,
    private readonly mockEcontractAdapter: MockEcontractAdapter,
  ) {}

  onModuleInit() {
    // Port 1: Contract (list/detail/versions/pdf)
    this.portRegistry.register('contract', this.mockContractAdapter, this.mockContractAdapter);
    // Port 2: e-Contract (retrieval + e-signature)
    this.portRegistry.register('econtract', this.mockEcontractAdapter, this.mockEcontractAdapter);
  }
}
