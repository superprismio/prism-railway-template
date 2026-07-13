import { randomUUID } from "node:crypto";
import {
  executeHttpJsonRead,
  GatewayDriverError,
  type HttpJsonReadResult,
} from "./http-json-read.js";
import { executeMcpToolCall, type McpToolCallResult } from "./mcp-tool-call.js";
import {
  GatewayStore,
  GatewayStoreError,
  normalizeHttpJsonReadConfig,
  normalizeMcpToolCallConfig,
} from "./store.js";
import type { GatewayCaller, GatewayInvocationContext } from "./types.js";

export type InvokeResult = {
  ok: boolean;
  status: number;
  traceId: string;
  capability: string;
  result?: unknown;
  usage: {
    units: number;
    estimatedCost: number;
    budgetStatus: "warning";
  };
  error?: { code: string; message: string; retryable: boolean };
};

type ExecuteRead = typeof executeHttpJsonRead;
type ExecuteMcp = typeof executeMcpToolCall;

function inputSummary(input: Record<string, unknown>) {
  return { keys: Object.keys(input).sort(), fieldCount: Object.keys(input).length };
}

export class GatewayInvoker {
  constructor(
    private readonly store: GatewayStore,
    private readonly executeRead: ExecuteRead = executeHttpJsonRead,
    private readonly executeMcp: ExecuteMcp = executeMcpToolCall,
  ) {}

  async invoke(input: {
    capabilityKey: string;
    capabilityInput: Record<string, unknown>;
    context: GatewayInvocationContext;
    caller: GatewayCaller;
    adminTest?: boolean;
  }): Promise<InvokeResult> {
    const traceId = randomUUID();
    const started = Date.now();
    const summary = inputSummary(input.capabilityInput);
    let policyDecision = input.adminTest ? "site_admin_test" : "not_evaluated";
    let units = 0;

    const fail = (
      code: string,
      status: number,
      retryable: boolean,
      auditStatus: "denied" | "failed",
    ): InvokeResult => {
      this.store.recordInvocation({
        traceId,
        capabilityKey: input.capabilityKey,
        caller: input.caller,
        context: input.context,
        status: auditStatus,
        policyDecision,
        latencyMs: Date.now() - started,
        errorCode: code,
        inputSummary: summary,
        outputSummary: null,
        units,
      });
      return {
        ok: false,
        status,
        traceId,
        capability: input.capabilityKey,
        usage: { units, estimatedCost: 0, budgetStatus: "warning" },
        error: { code, message: code, retryable },
      };
    };

    const capability = this.store.getCapability(input.capabilityKey);
    if (!capability) {
      policyDecision = "capability_not_found";
      return fail("CAPABILITY_NOT_FOUND", 404, false, "denied");
    }
    if (!capability.enabled) {
      policyDecision = "capability_disabled";
      return fail("CAPABILITY_DISABLED", 409, false, "denied");
    }
    if (!input.adminTest) {
      const grant = this.store.evaluateCallerGrant(input.caller, capability.key);
      policyDecision = grant.decision;
      if (!grant.allowed) return fail("CAPABILITY_POLICY_DENIED", 403, false, "denied");
    }
    if (!capability.connectionId) {
      return fail("CAPABILITY_CONNECTION_MISSING", 409, false, "failed");
    }
    const connection = this.store.getConnection(capability.connectionId);
    if (!connection || connection.status === "revoked") {
      return fail("CAPABILITY_CONNECTION_UNAVAILABLE", 409, false, "failed");
    }
    if (capability.driverKey !== "http-json.read" && capability.driverKey !== "mcp-tool.call") {
      return fail("CAPABILITY_DRIVER_UNSUPPORTED", 501, false, "failed");
    }

    units = 1;
    try {
      const credentials = this.store.getConnectionCredentials(connection.id);
      const executed: HttpJsonReadResult | McpToolCallResult = capability.driverKey === "http-json.read"
        ? await this.executeRead(
            normalizeHttpJsonReadConfig(capability.driverConfig),
            credentials,
            input.capabilityInput,
          )
        : await this.executeMcp(
            normalizeMcpToolCallConfig(capability.driverConfig),
            credentials,
            input.capabilityInput,
          );
      this.store.markConnectionUsed(connection.id, true);
      this.store.recordInvocation({
        traceId,
        capabilityKey: capability.key,
        caller: input.caller,
        context: input.context,
        status: "succeeded",
        policyDecision,
        latencyMs: Date.now() - started,
        inputSummary: summary,
        outputSummary: {
          downstreamStatus: executed.status,
          responseBytes: executed.responseBytes,
          resultType: Array.isArray(executed.result) ? "array" : typeof executed.result,
          ...("operation" in executed && "toolName" in executed
            ? { operation: executed.operation, toolName: executed.toolName }
            : {}),
        },
        units,
      });
      return {
        ok: true,
        status: 200,
        traceId,
        capability: capability.key,
        result: executed.result,
        usage: { units, estimatedCost: 0, budgetStatus: "warning" },
      };
    } catch (error) {
      if (error instanceof GatewayDriverError) {
        const callerInputError = error.code.startsWith("CAPABILITY_INPUT_");
        if (!callerInputError) this.store.markConnectionUsed(connection.id, false);
        return fail(error.code, callerInputError ? 400 : 502, error.retryable, "failed");
      }
      if (error instanceof GatewayStoreError) {
        return fail(error.code, error.status, false, "failed");
      }
      return fail("CAPABILITY_EXECUTION_FAILED", 500, true, "failed");
    }
  }
}
