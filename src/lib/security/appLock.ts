/**
 * Bloqueio do aplicativo por PIN neste aparelho.
 *
 * O PIN nunca sai do aparelho: guardamos só um hash PBKDF2 com sal aleatório no localStorage.
 * É uma camada extra para quem pega o celular desbloqueado; a sessão continua protegida pela senha no servidor.
 */

const STORAGE_KEY = 'clareza-app-lock';
const LAST_ACTIVE_KEY = 'clareza-app-last-active';
const ITERATIONS = 120_000;

export interface AppLockConfig {
  enabled: boolean;
  salt: string;
  hash: string;
  timeoutMinutes: number;
}

export const LOCK_TIMEOUT_OPTIONS = [1, 5, 15, 30] as const;
export const MAX_PIN_ATTEMPTS = 5;

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function derive(pin: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  return toHex(bits);
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export function lockAvailable(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

export function readLockConfig(): AppLockConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as AppLockConfig;
    return cfg.enabled && cfg.hash && cfg.salt ? cfg : null;
  } catch {
    return null;
  }
}

export async function enableLock(pin: string, timeoutMinutes: number): Promise<void> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = toHex(saltBytes.buffer);
  const hash = await derive(pin, salt);
  const cfg: AppLockConfig = { enabled: true, salt, hash, timeoutMinutes };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  markActive();
}

export function updateLockTimeout(timeoutMinutes: number): void {
  const cfg = readLockConfig();
  if (!cfg) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...cfg, timeoutMinutes }));
}

export function disableLock(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LAST_ACTIVE_KEY);
  } catch {
    /* ignora */
  }
}

export async function verifyPin(pin: string): Promise<boolean> {
  const cfg = readLockConfig();
  if (!cfg) return true;
  const hash = await derive(pin, cfg.salt);
  // comparação em tempo constante
  if (hash.length !== cfg.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ cfg.hash.charCodeAt(i);
  return diff === 0;
}

export function markActive(): void {
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
  } catch {
    /* ignora */
  }
}

/** true se passou mais tempo que o limite desde a última atividade registrada. */
export function shouldLockNow(): boolean {
  const cfg = readLockConfig();
  if (!cfg) return false;
  try {
    const last = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);
    return !last || Date.now() - last > cfg.timeoutMinutes * 60_000;
  } catch {
    return true;
  }
}
