export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { wakeWorkflowAgentRunDispatcher } = await import("@/lib/workflow-agent-run-queue");
  wakeWorkflowAgentRunDispatcher();
}
