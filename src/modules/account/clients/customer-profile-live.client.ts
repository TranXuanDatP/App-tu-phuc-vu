/**
 * LIVE adapter for the customer-profile port — calls the real Customer 360
 * service (customer-service) over HTTP via PortHttpClient.
 *
 * This is the "connection path" prepared ahead of the real service: it is
 * registered as the LIVE adapter in AccountModule, but stays DORMANT while
 * `api-endpoints.yaml` has `customer-profile.adapter: mock`. Flip that to
 * `live` (or set MOCK_MODE=false) the moment customer-service is up — no code
 * change needed.
 *
 * URL convention (InternalAdapterBase default): `${baseUrl}/${method}`, i.e.
 * the customer-service exposes method-name endpoints under `${BACKEND_BASE_URL}/customers`:
 *   GET   /customers/get-profile?customerId=...
 *   POST  /customers/find-by-phone          body { phone }
 *   POST  /customers/create-customer        body (CreateCustomerRequest)
 *   GET   /customers/get-timeline?customerId=...
 *   GET   /customers/get-related-accounts?customerId=...
 *   PUT   /customers/update-profile         body { customerId, ... }
 *
 * See docs/customer-service-contract.md for the full DTO contract.
 *
 * PortHttpClient handles: per-port timeout (AbortController), downstream JWT
 * injection, correlation-id propagation, idempotency key for POST/PUT.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalAdapterBase } from '@shared/port/internal-adapter.base';
import { PortHttpClient } from '@shared/port/port-http-client.service';

@Injectable()
export class CustomerProfileInternalAdapter extends InternalAdapterBase {
  constructor(httpClient: PortHttpClient, configService: ConfigService) {
    const base = (configService.get<string>('BACKEND_BASE_URL') ?? 'http://localhost:3001').replace(
      /\/$/,
      '',
    );
    super(
      'customer-profile',
      httpClient,
      {
        portName: 'customer-profile',
        baseUrl: `${base}/customers`,
        timeout: 5000,
        // Explicit verbs — without this, find-by-phone/create-customer would
        // default to POST (correct), but pinning keeps intent clear.
        methodMap: {
          'get-profile': 'GET',
          'get-timeline': 'GET',
          'get-related-accounts': 'GET',
          'find-by-phone': 'POST',
          'create-customer': 'POST',
          'update-profile': 'PUT',
        },
      },
    );
  }
}
