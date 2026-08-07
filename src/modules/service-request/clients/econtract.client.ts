/**
 * Mock adapter for the econtract port (downstream e-Contract service).
 *
 * OWNER-SCOPED (A2 Layer-2 sub-path): `get-contract` / `sign-contract` enforce dossier
 * ownership — a bound customer can only get/sign their own dossier. Ownership source =
 * mocks/econtract/get-contract.json (its `dossierId` + `customerId` = owner). Request for
 * another customer's dossierId, or an unknown dossierId → 404 (same shape, no oracle).
 *
 * Swap to an InternalAdapterBase when the real downstream is ready; ownership then enforced
 * downstream by customerId (SPEC-downstream §1).
 *
 * Methods: get-contract, sign-contract
 */
import { Injectable, Logger } from '@nestjs/common';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import { NotFoundException } from '@core/common';
import { EcontractResponseSchema, SignContractResultSchema } from '../dto/econtract.dto';

interface DossierOwner {
  dossierId: string;
  customerId: string; // owner
}

@Injectable()
export class MockEcontractAdapter extends MockAdapterBase {
  private ownerCache?: DossierOwner;

  constructor() {
    super(
      'econtract',
      {
        'get-contract': EcontractResponseSchema,
        'sign-contract': SignContractResultSchema,
      },
      new Logger('econtract-mock-adapter'),
    );
  }

  override async execute(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (
      params.dossierId &&
      (method === 'get-contract' || method === 'sign-contract')
    ) {
      await this.assertOwned(
        String(params.dossierId),
        params.customerId as string | undefined,
      );
    }
    return super.execute(method, params);
  }

  /** 404 if the dossierId is unknown or not owned by the bound customer (no oracle). */
  private async assertOwned(
    dossierId: string,
    customerId: string | undefined,
  ): Promise<void> {
    const owner = await this.loadOwner();
    if (
      !owner ||
      owner.dossierId !== dossierId ||
      (customerId && owner.customerId !== customerId)
    ) {
      throw new NotFoundException(
        'E-contract dossier not found',
        'ECONTRACT_NOT_FOUND',
        { dossierId },
      );
    }
  }

  /** Read the dossier owner (dossierId + customerId) once from get-contract.json. */
  private async loadOwner(): Promise<DossierOwner | undefined> {
    if (this.ownerCache) return this.ownerCache;
    const filePath = path.resolve(
      process.cwd(),
      'mocks',
      'econtract',
      'get-contract.json',
    );
    const raw = JSON.parse(
      await fsPromises.readFile(filePath, 'utf-8'),
    ) as Partial<DossierOwner>;
    if (raw.dossierId && raw.customerId) {
      this.ownerCache = { dossierId: raw.dossierId, customerId: raw.customerId };
    }
    return this.ownerCache;
  }
}
