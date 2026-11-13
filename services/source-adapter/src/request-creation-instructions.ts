/** Trusted instructions added on every transport turn, including resumed agent sessions. */
export function requestCreationInstructions(sourceSessionId: string, sourceMessageId: string | null) {
  const source = `sourceSessionId ${sourceSessionId}${sourceMessageId ? ` and sourceMessageId ${sourceMessageId}` : ''}`;
  return `When creating a request with POST /agent/change-board/requests, include ${source} and send the x-prism-request-creation-context header using the PRISM_REQUEST_CREATION_CONTEXT environment variable (for example, curl -H "x-prism-request-creation-context: $PRISM_REQUEST_CREATION_CONTEXT", or a Node header from process.env.PRISM_REQUEST_CREATION_CONTEXT). The source IDs do not replace that header. Do not supply identity display fields or expose the context value in output, logs, or artifacts.`;
}
