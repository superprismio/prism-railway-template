import assert from 'node:assert/strict';
import test from 'node:test';
import { requestCreationInstructions } from './request-creation-instructions.js';

test('transport instructions require the private header and preserve exact source references', () => {
  const instructions = requestCreationInstructions('session-123', 'discord-message-456');
  assert.match(instructions, /sourceSessionId session-123 and sourceMessageId discord-message-456/);
  assert.match(instructions, /x-prism-request-creation-context/);
  assert.match(instructions, /PRISM_REQUEST_CREATION_CONTEXT/);
  assert.match(instructions, /source IDs do not replace that header/);
  assert.doesNotMatch(instructions, /private-signed-context/);
});

test('transport instructions do not invent an absent source message', () => {
  const instructions = requestCreationInstructions('session-123', null);
  assert.match(instructions, /sourceSessionId session-123/);
  assert.doesNotMatch(instructions, /sourceMessageId/);
});
