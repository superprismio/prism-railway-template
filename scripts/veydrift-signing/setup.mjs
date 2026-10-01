#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const packageName = 'ethers';
const version = '6.17.0';
const defaultCacheRoot = '/data/custom/veydrift-signing';
const installTimeoutMs = 120_000;

export class DependencySetupError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = 'DependencySetupError';
    this.code = code;
  }
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

async function runNpmCi(stageDir) {
  await new Promise((resolve, reject) => {
    const child = spawn('npm', [
      'ci', '--prefix', stageDir, '--omit=dev', '--ignore-scripts',
      '--no-audit', '--no-fund',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, installTimeoutMs);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(new DependencySetupError('DEPENDENCY_INSTALL_FAILED', `npm ci could not start: ${error.message}`, error));
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) resolve();
      else reject(new DependencySetupError('DEPENDENCY_INSTALL_FAILED',
        timedOut ? 'npm ci timed out after 120 seconds' : `npm ci exited ${code}: ${stderr.trim()}`));
    });
  });
}

async function verifyEthers(modulePath) {
  const packageFile = path.join(modulePath, 'package.json');
  if (!existsSync(packageFile)) throw new Error('ethers package.json is absent');
  const packageJson = JSON.parse(await fs.readFile(packageFile, 'utf8'));
  if (packageJson.version !== version) throw new Error(`expected ethers ${version}; found ${packageJson.version}`);

  // This uses a fixed public test key and makes no network call or transaction.
  const require = createRequire(pathToFileURL(packageFile));
  const ethers = require(modulePath);
  if (ethers.version !== version) throw new Error(`ethers export is ${ethers.version}`);
  const wallet = new ethers.Wallet(`0x${'11'.repeat(32)}`);
  const message = 'Prism Veydrift dependency setup check';
  const signature = await wallet.signMessage(message);
  if (ethers.verifyMessage(message, signature) !== wallet.address) {
    throw new Error('offline signing verification failed');
  }
}

async function inspectPublished(entryDir, expected, verify) {
  const manifestPath = path.join(entryDir, '.ready.json');
  let ready;
  try {
    ready = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const installedLock = await fs.readFile(path.join(entryDir, 'package-lock.json'));
    if (ready.lockHash !== expected.lockHash || sha256(installedLock) !== expected.lockHash ||
        ready.version !== version || ready.nodeMajor !== expected.nodeMajor ||
        ready.platform !== process.platform || ready.arch !== process.arch) {
      throw new Error('cache manifest or lockfile does not match this runtime');
    }
    await verify(path.join(entryDir, 'node_modules', packageName));
  } catch (error) {
    throw new DependencySetupError('DEPENDENCY_CACHE_INVALID',
      `Published Veydrift signing cache is invalid at ${entryDir}: ${error.message}`, error);
  }
  return { version, modulePath: path.join(entryDir, 'node_modules', packageName),
    lockHash: expected.lockHash, cacheHit: true };
}

export async function setupSigningDependency({
  cacheRoot = defaultCacheRoot,
  install = runNpmCi,
  verify = verifyEthers,
} = {}) {
  if (!path.isAbsolute(cacheRoot)) {
    throw new DependencySetupError('DEPENDENCY_CACHE_PATH_INVALID', 'cache root must be absolute');
  }
  const lockData = await fs.readFile(path.join(sourceDir, 'package-lock.json'));
  const packageData = await fs.readFile(path.join(sourceDir, 'package.json'));
  const lockHash = sha256(lockData);
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const expected = { lockHash, nodeMajor, platform: process.platform, arch: process.arch, version };
  const key = `${packageName}-${version}-node${nodeMajor}-${process.platform}-${process.arch}-${lockHash}`;
  const entryDir = path.join(cacheRoot, key);
  await fs.mkdir(cacheRoot, { recursive: true });

  if (existsSync(entryDir)) return inspectPublished(entryDir, expected, verify);

  const stageDir = await fs.mkdtemp(path.join(cacheRoot, '.staging-'));
  try {
    await fs.writeFile(path.join(stageDir, 'package.json'), packageData);
    await fs.writeFile(path.join(stageDir, 'package-lock.json'), lockData);
    try {
      await install(stageDir);
      await verify(path.join(stageDir, 'node_modules', packageName));
    } catch (error) {
      if (error instanceof DependencySetupError) throw error;
      throw new DependencySetupError('DEPENDENCY_INSTALL_FAILED',
        `Veydrift signing dependency install or verification failed: ${error.message}`, error);
    }
    await fs.writeFile(path.join(stageDir, '.ready.json'), `${JSON.stringify(expected)}\n`);
    try {
      await fs.rename(stageDir, entryDir);
      return { version, modulePath: path.join(entryDir, 'node_modules', packageName),
        lockHash, cacheHit: false };
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error;
      // Another run published first. Its complete cache must pass the same checks.
      return inspectPublished(entryDir, expected, verify);
    }
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true });
  }
}

function readArgs(argv) {
  if (argv.length === 0) return {};
  if (argv.length === 2 && argv[0] === '--cache-root' && argv[1]) {
    return { cacheRoot: argv[1] };
  }
  throw new DependencySetupError('DEPENDENCY_SETUP_USAGE', 'usage: node setup.mjs [--cache-root ABSOLUTE_PATH]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  Promise.resolve().then(() => readArgs(process.argv.slice(2)))
    .then(options => setupSigningDependency(options))
    .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error => {
      process.stderr.write(`${error.code || 'DEPENDENCY_SETUP_FAILED'}: ${error.message}\n`);
      process.exitCode = 1;
    });
}
