// app/lib/studio/lidarBridge.ts
// Puntea live iPhone LiDAR / Apple RoomPlan → Studio (modul pur, testat în Node; fără importuri `@/`).
// Backend: POST /api/studio/lidar/pair · POST /api/studio/lidar/upload (aplicația iOS) · GET /api/studio/lidar/latest.
// Scanarea primită este exact fișierul trimis de pe iPhone: îl reconstruim ca fișier (nume + octeți) și îl dăm
// aceluiași `parseScanFile` / `parseScanFiles` din `lidarParser.ts` ca la importul manual — zero diferențe de parsare.

export interface LidarPairResponse {
  code: string;
  expiresAtUtc: string;
  uploadUrl: string;
  serverUrl?: string;
}

export interface LidarLatestWaiting {
  hasNewScan: false;
  expiresAtUtc?: string;
  codeExpired?: boolean;
}

export interface LidarLatestScan {
  hasNewScan: true;
  scanId: string;
  fileName: string;
  contentType: string;
  /** `utf8` = `rawPayload` este textul fișierului (.json / .obj); `base64` = octeții (.zip / .usdz). */
  encoding: 'utf8' | 'base64';
  rawPayload: string;
  sizeBytes?: number;
  uploadedAtUtc: string;
  expiresAtUtc?: string;
  codeExpired?: boolean;
}

export type LidarLatestResponse = LidarLatestWaiting | LidarLatestScan;

/** Intervalul de interogare al Studio-ului cât timp puntea e deschisă. */
export const BRIDGE_POLL_MS = 2500;

export const isPairingCode = (code: string) => /^\d{6}$/.test(code);

/** „482910” → „482 910” (citire ușoară de pe ecran). */
export const formatPairingCode = (code: string) => (isPairingCode(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code);

/** Secunde rămase până la expirarea codului (0 dacă a expirat sau data e invalidă). */
export function secondsUntil(expiresAtUtc: string, now: number = Date.now()): number {
  const t = Date.parse(expiresAtUtc);
  return Number.isFinite(t) ? Math.max(0, Math.floor((t - now) / 1000)) : 0;
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface BridgeFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

/** Octeții și numele fișierului scanat, exact cum au plecat de pe iPhone. */
export function bridgeScanToFile(scan: LidarLatestScan): BridgeFile {
  const bytes = scan.encoding === 'base64' ? decodeBase64(scan.rawPayload) : new TextEncoder().encode(scan.rawPayload);
  return { name: scan.fileName, type: scan.contentType, bytes };
}

/** Forma `ScanFileLike` din `lidarParser.ts` (nume + `arrayBuffer()`), fără dependență de `File` din browser. */
export function bridgeScanFileLike(scan: LidarLatestScan): { name: string; arrayBuffer: () => Promise<ArrayBuffer> } {
  const { name, bytes } = bridgeScanToFile(scan);
  return { name, arrayBuffer: async () => bytes.slice().buffer };
}

/** Validează răspunsul `GET /latest` (nu ne bazăm orbește pe rețea). */
export function readLatest(data: unknown): LidarLatestResponse {
  if (!data || typeof data !== 'object') return { hasNewScan: false };
  const o = data as Record<string, unknown>;
  const base = { expiresAtUtc: typeof o.expiresAtUtc === 'string' ? o.expiresAtUtc : undefined, codeExpired: o.codeExpired === true };
  if (
    o.hasNewScan === true &&
    typeof o.scanId === 'string' &&
    typeof o.fileName === 'string' &&
    typeof o.rawPayload === 'string' &&
    (o.encoding === 'utf8' || o.encoding === 'base64')
  ) {
    return {
      ...base,
      hasNewScan: true,
      scanId: o.scanId,
      fileName: o.fileName,
      contentType: typeof o.contentType === 'string' ? o.contentType : 'application/octet-stream',
      encoding: o.encoding,
      rawPayload: o.rawPayload,
      sizeBytes: typeof o.sizeBytes === 'number' ? o.sizeBytes : undefined,
      uploadedAtUtc: typeof o.uploadedAtUtc === 'string' ? o.uploadedAtUtc : new Date().toISOString(),
    };
  }
  return { ...base, hasNewScan: false };
}
