import { randomBytes } from "node:crypto";
import type { GatewayInvocationContext, PrismGatewayClient } from "./gateway-client.js";
import { RuntimeCapabilityError } from "./runtime-capabilities.js";

type ToolsetSession = { keys: Set<string>; context: GatewayInvocationContext; expiresAt: number };

export class RuntimeToolsetSessions {
  private readonly sessions = new Map<string, ToolsetSession>();

  constructor(private readonly gatewayClient: Pick<PrismGatewayClient, "toolsetRequest">, private readonly now: () => number = Date.now) {}

  create(keys: string[], context: GatewayInvocationContext, ttlMs: number) {
    this.prune();
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, { keys: new Set(keys), context, expiresAt: this.now() + ttlMs });
    return token;
  }

  revoke(token: string) { this.sessions.delete(token); }

  assertActive(token: string) {
    const session = this.sessions.get(token);
    if (!session) throw new RuntimeCapabilityError("RUNTIME_TOOLSET_SESSION_INVALID", 401);
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(token);
      throw new RuntimeCapabilityError("RUNTIME_TOOLSET_SESSION_EXPIRED", 401);
    }
    return session;
  }

  async invoke(token: string, toolset: string, action: "describe" | "request", request?: Record<string, unknown>) {
    const session = this.assertActive(token);
    if (!session.keys.has(toolset)) throw new RuntimeCapabilityError("RUNTIME_TOOLSET_NOT_ASSIGNED", 403);
    return this.gatewayClient.toolsetRequest({ toolset, action, request, context: session.context });
  }

  private prune() {
    const now = this.now();
    for (const [token, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(token);
  }
}
