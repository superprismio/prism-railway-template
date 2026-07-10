export type GatewayInvocationContext = {
  delegatedActorId?: string;
  requestId?: string;
  workflowRunId?: string;
  workflowStepKey?: string;
  runtimeJobId?: string;
};

export type GatewayInvokeResponse = {
  ok: boolean;
  status: number;
  traceId: string;
  capability: string;
  result?: unknown;
  usage?: {
    units: number;
    estimatedCost: number;
    budgetStatus: string;
  };
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
};

type GatewayClientConfig = {
  enabled: boolean;
  baseUrl: string | null;
  token: string | null;
  timeoutMs: number;
};

type GatewayInvokeInput = {
  capability: string;
  input: Record<string, unknown>;
  context?: GatewayInvocationContext;
};

export class GatewayClientError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly retryable: boolean,
    public readonly traceId: string | null = null,
  ) {
    super(code);
  }
}

export class PrismGatewayClient {
  constructor(
    private readonly config: GatewayClientConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  status() {
    return {
      enabled: this.config.enabled,
      configured: Boolean(this.config.baseUrl && this.config.token),
    };
  }

  async invoke(invocation: GatewayInvokeInput): Promise<GatewayInvokeResponse> {
    if (!this.config.enabled) {
      throw new GatewayClientError('PRISM_GATEWAY_DISABLED', 503, false);
    }
    if (!this.config.baseUrl || !this.config.token) {
      throw new GatewayClientError('PRISM_GATEWAY_NOT_CONFIGURED', 503, false);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}/invoke`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-gateway-token': this.config.token,
        },
        body: JSON.stringify({
          capability: invocation.capability,
          input: invocation.input,
          context: invocation.context || {},
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch {
      throw new GatewayClientError('PRISM_GATEWAY_UNREACHABLE', 502, true);
    }

    const body = await response.json().catch(() => null) as GatewayInvokeResponse | null;
    if (!body || typeof body !== 'object') {
      throw new GatewayClientError('PRISM_GATEWAY_RESPONSE_INVALID', 502, true);
    }
    if (!response.ok || body.ok === false) {
      throw new GatewayClientError(
        body.error?.code || `PRISM_GATEWAY_HTTP_${response.status}`,
        response.status,
        body.error?.retryable === true,
        typeof body.traceId === 'string' ? body.traceId : null,
      );
    }
    return body;
  }
}
