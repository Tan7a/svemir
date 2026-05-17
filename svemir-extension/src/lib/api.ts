import type {
  ExtractedAsset,
  RecentChannel,
  Settings,
  Suggestion,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  settings: Settings,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  if (!settings.token) {
    throw new ApiError("No API token configured. Open Settings.", 401);
  }
  const res = await fetch(`${settings.baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* body wasn't json */
    }
    throw new ApiError(msg, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function listChannels(
  settings: Settings
): Promise<{ id: string; slug: string; title: string }[]> {
  return request(settings, "/api/v1/channels", { method: "GET" });
}

export function listRecentChannels(
  settings: Settings
): Promise<RecentChannel[]> {
  return request(settings, "/api/v1/channels/recent", { method: "GET" });
}

export function suggestChannels(
  settings: Settings,
  input: { title: string; description: string; source_name: string }
): Promise<Suggestion[]> {
  return request(settings, "/api/v1/suggest-channels", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createBlock(
  settings: Settings,
  asset: ExtractedAsset,
  channels: string[]
): Promise<{ id: string }> {
  return request(settings, "/api/v1/blocks", {
    method: "POST",
    body: JSON.stringify({
      source: asset.url,
      kind: asset.kind,
      title: asset.title,
      description: asset.description,
      image_url: asset.image_url,
      source_name: asset.source_name,
      channels,
      body_text: asset.body_text,
    }),
  });
}

export async function uploadImage(
  settings: Settings,
  blob: Blob,
  filename = "screenshot.png"
): Promise<{ url: string }> {
  if (!settings.token) {
    throw new ApiError("No API token configured. Open Settings.", 401);
  }
  const fd = new FormData();
  fd.append("file", blob, filename);
  const res = await fetch(`${settings.baseUrl}/api/v1/upload-image`, {
    method: "POST",
    body: fd,
    headers: { Authorization: `Bearer ${settings.token}` },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* body wasn't json */
    }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as { url: string };
}
