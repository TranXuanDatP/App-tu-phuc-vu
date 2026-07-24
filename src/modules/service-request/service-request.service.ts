/**
 * ServiceRequest service — lean BFF orchestrator over the contract + econtract
 * ports. Thin pass-through to PortRegistry; no business logic. Methods are the
 * former CQRS handlers' execute() bodies (contract: get-contracts,
 * get-contract-detail, get-contract-versions, get-contract-pdf; econtract:
 * get-contract, sign-contract). Input validation (moved from the old
 * controllers) lives here.
 */
import { Injectable } from '@nestjs/common';
import { PortRegistry } from '@shared/port';
import { ValidationException } from '@core/common';
import { ContractQuerySchema, ContractIdParamSchema } from './dto/contract-query.dto';
import { SignContractBodySchema } from './dto/econtract.dto';
import type {
  ContractListResponse,
  ContractDetailResponse,
  ContractVersionsResponse,
  ContractPDFResponse,
} from './dto/contract.dto';
import type { EcontractResponse, SignContractResult } from './dto/econtract.dto';

@Injectable()
export class ServiceRequestService {
  constructor(private readonly portRegistry: PortRegistry) {}

  // ── Contract port ────────────────────────────────────────────────────────────

  /** AC#1 — GET /contracts: customer's contract list with optional status filter. */
  async getContracts(
    customerId: string,
    query: unknown,
  ): Promise<ContractListResponse> {
    const parsed = ContractQuerySchema.safeParse(query);
    const filters = parsed.success ? parsed.data : undefined;
    const result = await this.portRegistry.execute<ContractListResponse>(
      'contract',
      'get-contracts',
      { customerId, filters },
    );
    return result.data;
  }

  /** AC#2 — GET /contracts/:contractId: full contract detail. */
  async getContractDetail(
    customerId: string,
    contractId: string,
  ): Promise<ContractDetailResponse> {
    this.validateContractId(contractId);
    const result = await this.portRegistry.execute<ContractDetailResponse>(
      'contract',
      'get-contract-detail',
      { customerId, contractId },
    );
    return result.data;
  }

  /** AC#3 — GET /contracts/:contractId/versions: contract version history. */
  async getContractVersions(
    customerId: string,
    contractId: string,
  ): Promise<ContractVersionsResponse> {
    this.validateContractId(contractId);
    const result = await this.portRegistry.execute<ContractVersionsResponse>(
      'contract',
      'get-contract-versions',
      { customerId, contractId },
    );
    return result.data;
  }

  /** AC#4 — GET /contracts/:contractId/pdf: contract PDF download URL. */
  async getContractPDF(
    customerId: string,
    contractId: string,
  ): Promise<ContractPDFResponse> {
    this.validateContractId(contractId);
    const result = await this.portRegistry.execute<ContractPDFResponse>(
      'contract',
      'get-contract-pdf',
      { customerId, contractId },
    );
    return result.data;
  }

  // ── Econtract port ───────────────────────────────────────────────────────────

  /** GET /econtracts/:dossierId: retrieve a digital contract dossier. */
  async getEcontract(
    customerId: string,
    dossierId: string,
  ): Promise<EcontractResponse> {
    const result = await this.portRegistry.execute<EcontractResponse>(
      'econtract',
      'get-contract',
      { customerId, dossierId },
    );
    return result.data;
  }

  /** POST /econtracts/:dossierId/sign: e-sign a contract dossier. */
  async signEcontract(
    customerId: string,
    dossierId: string,
    body: unknown,
  ): Promise<SignContractResult> {
    const parsed = SignContractBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }
    const result = await this.portRegistry.execute<SignContractResult>(
      'econtract',
      'sign-contract',
      {
        customerId,
        dossierId,
        signatureRef: parsed.data.signatureRef,
        useCache: false,
      },
    );
    return result.data;
  }

  // ── Input validation (moved from old controllers) ────────────────────────────

  private validateContractId(contractId: string): void {
    const parsed = ContractIdParamSchema.safeParse(contractId);
    if (!parsed.success) {
      throw new ValidationException('Invalid contract ID format');
    }
  }
}
