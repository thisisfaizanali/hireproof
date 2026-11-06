export type ApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      error: string;
      fields: Record<string, string>;
    };

export const UNREACHABLE =
  "Cannot reach the server. Check your connection and try again.";
export const SERVER_ERROR =
  "Something went wrong on our side. Try again in a moment.";

// Calls the API through the web origin. Pass `json` for a JSON body or `form`
// for an upload; every failure comes back as a value, never a throw.
export async function api<T>(
  path: string,
  options: { method?: string; json?: unknown; form?: FormData } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.form) {
    headers["X-Requested-With"] = "hireproof";
    body = options.form;
  } else if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  try {
    const res = await fetch(path, {
      method: options.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: data as T };
    if (data === null) {
      return {
        ok: false,
        status: res.status,
        error: res.status >= 500 ? UNREACHABLE : SERVER_ERROR,
        fields: {},
      };
    }
    return {
      ok: false,
      status: res.status,
      error: res.status >= 500 ? SERVER_ERROR : (data.error ?? SERVER_ERROR),
      fields: data.fields ?? {},
    };
  } catch {
    return { ok: false, status: 0, error: UNREACHABLE, fields: {} };
  }
}
