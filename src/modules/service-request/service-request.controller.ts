/**
 * ServiceRequest controllers — REST endpoints for contract & e-contract (route
 * prefixes /contracts and /econtracts preserved for FE contract). Thin:
 * route + auth → delegates to ServiceRequestService. No CQRS, no validation
 * (lives in the service).
 */
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/infrastructure/decorators/current-user.decorator';
import { RequiresBinding } from '../binding/decorators/requires-binding.decorator';
import { ServiceRequestService } from './service-request.service';

// ═════════════════════════════════════════════════════════════════════════════
// Contract
// ═════════════════════════════════════════════════════════════════════════════

@ApiTags('Contract')
@ApiBearerAuth('JWT-auth')
@RequiresBinding()
@Controller('contracts')
export class ContractController {
  constructor(private readonly serviceRequestService: ServiceRequestService) {}

  /**
   * GET /contracts
   * Get customer's contract list (AC#1)
   */
  @Get()
  @ApiOperation({ summary: 'Get customer contracts' })
  getContracts(@CurrentUser('id') userId: string, @Query() query: unknown) {
    return this.serviceRequestService.getContracts(userId, query);
  }

  /**
   * GET /contracts/:contractId
   * Get contract detail (AC#2)
   */
  @Get(':contractId')
  @ApiOperation({ summary: 'Get contract detail' })
  getContractDetail(
    @CurrentUser('id') userId: string,
    @Param('contractId') contractId: string,
  ) {
    return this.serviceRequestService.getContractDetail(userId, contractId);
  }

  /**
   * GET /contracts/:contractId/versions
   * Get contract version history (AC#3)
   */
  @Get(':contractId/versions')
  @ApiOperation({ summary: 'Get contract version history' })
  getContractVersions(
    @CurrentUser('id') userId: string,
    @Param('contractId') contractId: string,
  ) {
    return this.serviceRequestService.getContractVersions(userId, contractId);
  }

  /**
   * GET /contracts/:contractId/pdf
   * Get contract PDF download URL (AC#4)
   */
  @Get(':contractId/pdf')
  @ApiOperation({ summary: 'Get contract PDF download URL' })
  getContractPDF(
    @CurrentUser('id') userId: string,
    @Param('contractId') contractId: string,
  ) {
    return this.serviceRequestService.getContractPDF(userId, contractId);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// e-Contract
// ═════════════════════════════════════════════════════════════════════════════

@ApiTags('e-Contract')
@ApiBearerAuth('JWT-auth')
@RequiresBinding()
@Controller('econtracts')
export class EcontractController {
  constructor(private readonly serviceRequestService: ServiceRequestService) {}

  /**
   * GET /econtracts/:dossierId
   * Get digital contract dossier
   */
  @Get(':dossierId')
  get(@CurrentUser('id') userId: string, @Param('dossierId') dossierId: string) {
    return this.serviceRequestService.getEcontract(userId, dossierId);
  }

  /**
   * POST /econtracts/:dossierId/sign
   * e-Sign a contract dossier
   */
  @Post(':dossierId/sign')
  sign(
    @CurrentUser('id') userId: string,
    @Param('dossierId') dossierId: string,
    @Body() body: { signatureRef: string },
  ) {
    return this.serviceRequestService.signEcontract(userId, dossierId, body);
  }
}
