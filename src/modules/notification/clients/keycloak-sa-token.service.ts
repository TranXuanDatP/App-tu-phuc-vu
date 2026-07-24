import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Keycloak Service-Account token (client_credentials) for BFF→platform calls
 * (notification-be-rs gRPC). Ported from admin-portal-bff/KeycloakTokenProvider.cs.
 *
 * Single-flight cached until expires_in - 10s. Optional: if KEYCLOAK_SA_CLIENT_ID /
 * SECRET are unset, getToken() returns null — for local dev with notification-be-rs
 * AUTH_ENABLED=false (no auth). notification-be-rs validates RS256 + issuer only
 * (validate_aud=false), so a standard SA token passes gRPC Send (no role needed).
 */
@Injectable()
export class KeycloakSaTokenService {
  private readonly logger = new Logger(KeycloakSaTokenService.name);
  private token: string | null = null;
  private expiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>("KEYCLOAK_SA_CLIENT_ID") &&
        this.config.get<string>("KEYCLOAK_SA_CLIENT_SECRET"),
    );
  }

  async getToken(): Promise<string | null> {
    if (!this.isConfigured()) return null; // AUTH_ENABLED=false dev path
    const now = Date.now();
    if (this.token && now < this.expiresAt) return this.token;

    const base = this.config.get<string>("KEYCLOAK_URL", "http://localhost:8080");
    const realm = this.config.get<string>("KEYCLOAK_REALM", "water-platform");
    const clientId = this.config.get<string>("KEYCLOAK_SA_CLIENT_ID") as string;
    const clientSecret = this.config.get<string>("KEYCLOAK_SA_CLIENT_SECRET") as string;
    const endpoint = `${base}/realms/${realm}/protocol/openid-connect/token`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      this.logger.error(`Keycloak SA token failed: ${res.status} ${detail}`);
      throw new Error(`Keycloak SA token failed: ${res.status}`);
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = body.access_token;
    this.expiresAt = now + Math.max(0, (body.expires_in ?? 60) - 10) * 1000;
    return this.token;
  }
}
