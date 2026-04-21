import process from 'node:process';
import express from 'express';
import { config } from './config.js';
import { generateCodexCliReply } from './codex-runtime.js';
import { listPrismSkills } from './prism-skills.js';

const startedAt = new Date();
const app = express();

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'codex-runtime',
    uptimeSeconds: Math.floor(process.uptime()),
    startedAt: startedAt.toISOString(),
    codexBinary: config.codexBinary,
    codexHome: config.codexHome,
    codexRuntimeEnabled: config.codexRuntimeEnabled,
  });
});

app.get('/codex/health', (_req, res) => {
  res.json({ ok: true, provider: 'codex-cli' });
});

app.get('/skills', async (_req, res) => {
  try {
    const skills = await listPrismSkills();
    res.json({ ok: true, skills });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown skills error';
    res.status(500).json({ ok: false, error: message });
  }
});

app.post('/v1/responses', async (req, res) => {
  const body = req.body as {
    prompt?: unknown;
    sessionId?: unknown;
    codexThreadId?: unknown;
    recentHistory?: Array<{ role?: unknown; content?: unknown }>;
    metadata?: Record<string, unknown>;
  };

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';

  if (!prompt || !sessionId) {
    res.status(400).json({ ok: false, error: 'prompt and sessionId are required' });
    return;
  }

  try {
    const result = await generateCodexCliReply({
      prompt,
      sessionId,
      codexThreadId: typeof body.codexThreadId === 'string' ? body.codexThreadId.trim() : null,
      recentHistory: Array.isArray(body.recentHistory)
        ? body.recentHistory
          .map((entry) => ({
            role: typeof entry?.role === 'string' ? entry.role : 'user',
            content: typeof entry?.content === 'string' ? entry.content : '',
          }))
          .filter((entry) => entry.content.trim())
        : [],
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    });

    res.json({
      id: result.codexThreadId,
      object: 'response',
      model: result.model,
      provider: result.provider,
      responseText: result.responseText,
      output_text: result.responseText,
      thread_id: result.codexThreadId,
      branchName: result.branchName,
      commitSha: result.commitSha,
      branchUrl: result.branchUrl,
      baseBranch: result.baseBranch,
      baseCommitSha: result.baseCommitSha,
      trace: result.trace,
      sessionId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown codex runtime error';
    const candidate = error as Error & {
      codexThreadId?: string | null;
      trace?: Array<{ at: string; kind: string; message: string }>;
    };
    res.status(500).json({
      ok: false,
      error: message,
      thread_id: candidate.codexThreadId ?? null,
      trace: Array.isArray(candidate.trace) ? candidate.trace : [],
    });
  }
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`codex-runtime listening on ${config.port}`);
});
