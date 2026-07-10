import { randomBytes } from 'node:crypto';
import type {
  GatewayInvocationContext,
  GatewayInvokeResponse,
  PrismGatewayClient,
} from './gateway-client.js';

type CapabilitySession = {
  capabilityKeys: Set<string>;
  context: GatewayInvocationContext;
  expiresAt: number;
};

export class RuntimeCapabilityError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

export class RuntimeCapabilitySessions {
  private readonly sessions = new Map<string, CapabilitySession>();

  constructor(
    private readonly gatewayClient: Pick<PrismGatewayClient, 'invoke'>,
    private readonly now: () => number = Date.now,
  ) {}

  create(
    capabilityKeys: string[],
    context: GatewayInvocationContext,
    ttlMs: number,
  ) {
    this.prune();
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, {
      capabilityKeys: new Set(capabilityKeys),
      context,
      expiresAt: this.now() + ttlMs,
    });
    return token;
  }

  revoke(token: string) {
    this.sessions.delete(token);
  }

  async invoke(
    token: string,
    capability: string,
    input: Record<string, unknown>,
  ): Promise<GatewayInvokeResponse> {
    const session = this.sessions.get(token);
    if (!session) {
      throw new RuntimeCapabilityError('RUNTIME_CAPABILITY_SESSION_INVALID', 401);
    }
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(token);
      throw new RuntimeCapabilityError('RUNTIME_CAPABILITY_SESSION_EXPIRED', 401);
    }
    if (!session.capabilityKeys.has(capability)) {
      throw new RuntimeCapabilityError('RUNTIME_CAPABILITY_NOT_ASSIGNED', 403);
    }
    return this.gatewayClient.invoke({ capability, input, context: session.context });
  }

  private prune() {
    const now = this.now();
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(token);
    }
  }
}
