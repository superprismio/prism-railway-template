import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { AppConfig } from './config.js';

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function createSessionRecord(config: AppConfig, userId: string, tokenHash: string) {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + config.sessionMaxAgeMs).toISOString();

  return {
    id: randomUUID(),
    userId,
    tokenHash,
    createdAt,
    lastSeenAt: createdAt,
    expiresAt,
  };
}

export function setSessionCookie(res: Response, config: AppConfig, token: string) {
  res.cookie(config.sessionCookieName, token, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: config.sessionMaxAgeMs,
    path: '/',
  });
}

export function clearSessionCookie(res: Response, config: AppConfig) {
  res.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
  });
}