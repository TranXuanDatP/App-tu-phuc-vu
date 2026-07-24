import path from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import type { IPortAdapter } from "@shared/port/port.interface";
import { KeycloakSaTokenService } from "./keycloak-sa-token.service";
import { MockNotificationAdapter } from "./notification.client";

/**
 * Live adapter for the `notification` port — sends OTP via notification-be-rs gRPC
 * (`notification.v1.NotificationService/Send`). Extends PortRegistry with gRPC
 * support (the HTTP InternalAdapterBase can't speak gRPC).
 *
 * Config-gated by `NOTIFICATION_GRPC_URL`:
 *  - set → gRPC Send to notification-be-rs (SA token via `authorization` metadata
 *    when KEYCLOAK_SA_* configured; else no auth — works with AUTH_ENABLED=false dev).
 *  - unset (or gRPC fails) → silent fallback `{sent:true}` so the login OTP flow
 *    still works without the platform wired (better-auth setup logs the OTP in dev).
 *
 * Read methods (preferences/history/dispatch) delegate to the mock adapter for now.
 */
@Injectable()
export class NotificationGrpcAdapter implements IPortAdapter {
  private readonly logger = new Logger("notification-grpc-adapter");
  private client: grpc.Client | null = null;
  private readonly grpcUrl?: string;
  private readonly tenantId: string;

  constructor(
    private readonly config: ConfigService,
    private readonly tokens: KeycloakSaTokenService,
    private readonly mock: MockNotificationAdapter,
  ) {
    this.grpcUrl = this.config.get<string>("NOTIFICATION_GRPC_URL");
    this.tenantId = this.config.get<string>("NOTIFICATION_TENANT_ID", "tnt_hawaco");
    if (this.grpcUrl) this.initClient();
  }

  private initClient(): void {
    const protoPath = path.resolve(process.cwd(), "src/libs/shared/proto/notification.proto");
    const pkgDef = protoLoader.loadSync(protoPath, {
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = grpc.loadPackageDefinition(pkgDef) as unknown as {
      notification: { v1: { NotificationService: new (addr: string, creds: grpc.ChannelCredentials) => grpc.Client } };
    };
    const Service = proto.notification.v1.NotificationService;
    this.client = new Service(this.grpcUrl as string, grpc.credentials.createInsecure());
    this.logger.log(`gRPC client → ${this.grpcUrl}`);
  }

  async execute(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === "send-otp") {
      return this.sendOtp(params as { phoneNumber: string; code: string });
    }
    return this.mock.execute(method, params); // delegate reads + dispatch to mock for now
  }

  private async sendOtp({
    phoneNumber,
    code,
  }: {
    phoneNumber: string;
    code: string;
  }): Promise<unknown> {
    if (!this.grpcUrl || !this.client) return { sent: true }; // dev fallback

    const token = await this.tokens.getToken().catch((err: Error) => {
      this.logger.warn(`SA token unavailable, sending without auth: ${err.message}`);
      return null;
    });
    const metadata = new grpc.Metadata();
    if (token) metadata.set("authorization", `Bearer ${token}`);

    const request = {
      template_key: "customer.otp",
      tenant_id: this.tenantId,
      recipients: [{ user_id: "", phone: phoneNumber, email: "" }],
      channels: ["sms"],
      data_json: JSON.stringify({ otp: code }),
      locale: "",
      idempotency_key: `otp:${phoneNumber}:${code}`,
    };

    return new Promise<unknown>((resolve) => {
      (this.client as unknown as { Send: (req: unknown, meta: grpc.Metadata, cb: (e: Error | null, r: unknown) => void) => void }).Send(
        request,
        metadata,
        (err, reply) => {
          if (err) {
            this.logger.warn(`gRPC Send failed, fallback: ${err.message}`);
            resolve({ sent: true }); // don't block login on platform outage
            return;
          }
          const r = reply as { notification_id: string; status: string };
          this.logger.log(`OTP dispatched via notification-be-rs: ${r.notification_id} (${r.status})`);
          resolve({ sent: true, notificationId: r.notification_id, status: r.status });
        },
      );
    });
  }
}
