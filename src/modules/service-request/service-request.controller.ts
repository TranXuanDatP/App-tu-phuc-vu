/**
 * ServiceRequest controllers — REST endpoints for contract & e-contract (route
 * prefixes /contracts and /econtracts preserved for FE contract). Thin:
 * route + auth → delegates to ServiceRequestService. No CQRS, no validation
 * (lives in the service).
 */
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomerId } from '../binding/decorators/current-customer.decorator';
import { ServiceRequestService } from './service-request.service';

// ═════════════════════════════════════════════════════════════════════════════
// Contract
// ═════════════════════════════════════════════════════════════════════════════

@ApiTags('Contract')
@ApiBearerAuth('JWT-auth')
@Controller('contracts')
export class ContractController {
  constructor(private readonly serviceRequestService: ServiceRequestService) {}

  /**
   * GET /contracts
   * Get customer's contract list (AC#1)
   */
  @Get()
  @ApiOperation({ summary: 'Get customer contracts' })
  getContracts(@CustomerId() customerId: string, @Query() query: unknown) {
    return this.serviceRequestService.getContracts(customerId, query);
  }

  /**
   * GET /contracts/:contractId
   * Get contract detail (AC#2)
   */
  @Get(':contractId')
  @ApiOperation({ summary: 'Get contract detail' })
  getContractDetail(
    @CustomerId() customerId: string,
    @Param('contractId') contractId: string,
  ) {
    return this.serviceRequestService.getContractDetail(customerId, contractId);
  }

  /**
   * GET /contracts/:contractId/versions
   * Get contract version history (AC#3)
   */
  @Get(':contractId/versions')
  @ApiOperation({ summary: 'Get contract version history' })
  getContractVersions(
    @CustomerId() customerId: string,
    @Param('contractId') contractId: string,
  ) {
    return this.serviceRequestService.getContractVersions(customerId, contractId);
  }

  /**
   * GET /contracts/:contractId/pdf
   * Get contract PDF download URL (AC#4)
   */
  @Get(':contractId/pdf')
  @ApiOperation({ summary: 'Get contract PDF download URL' })
  getContractPDF(
    @CustomerId() customerId: string,
    @Param('contractId') contractId: string,
  ) {
    return this.serviceRequestService.getContractPDF(customerId, contractId);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// e-Contract
// ═════════════════════════════════════════════════════════════════════════════

@ApiTags('e-Contract')
@ApiBearerAuth('JWT-auth')
@Controller('econtracts')
export class EcontractController {
  constructor(private readonly serviceRequestService: ServiceRequestService) {}

  /**
   * GET /econtracts/:dossierId
   * Get digital contract dossier
   */
  @Get(':dossierId')
  get(@CustomerId() customerId: string, @Param('dossierId') dossierId: string) {
    return this.serviceRequestService.getEcontract(customerId, dossierId);
  }

  /**
   * POST /econtracts/:dossierId/sign
   * e-Sign a contract dossier
   */
  @Post(':dossierId/sign')
  sign(
    @CustomerId() customerId: string,
    @Param('dossierId') dossierId: string,
    @Body() body: { signatureRef: string },
  ) {
    return this.serviceRequestService.signEcontract(customerId, dossierId, body);
  }
}
