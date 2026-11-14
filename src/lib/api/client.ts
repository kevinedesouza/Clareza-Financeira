export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    idempotencyKey?: string;
  } = {}
): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new ApiError(0, 'OFFLINE', 'Sem conexão. Conecte-se para consultar e salvar.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.idempotencyKey) {
    headers['X-Idempotency-Key'] = options.idempotencyKey;
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method || 'GET',
      headers,
      credentials: 'include',
      cache: 'no-store',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK_UNCERTAIN',
      'Não foi possível confirmar. Verifique o status antes de tentar novamente.'
    );
  }

  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }

  if (!response.ok) {
    const code = typeof parsed.code === 'string' ? parsed.code : `HTTP_${response.status}`;
    const msg =
      typeof parsed.message === 'string'
        ? parsed.message
        : response.status === 401
          ? 'Entre novamente para continuar.'
          : 'Erro ao processar operação.';
    throw new ApiError(response.status, code, msg);
  }

  return parsed as T;
}

export function createOperationKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
