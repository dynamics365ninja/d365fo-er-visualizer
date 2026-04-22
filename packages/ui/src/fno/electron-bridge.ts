/**
 * Thin wrapper over `window.electronAPI` exposing a strongly-typed view of
 * the IPC surface. Returns `null` when running in a pure browser.
 */

export interface ElectronFnoRequest {
  url: string;
  token: string;
  responseType: 'json' | 'binary';
  timeoutMs?: number;
}

export interface ElectronFnoResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  json?: unknown;
  binaryBase64?: string;
  bodyText?: string;
}

export interface ElectronFnoAuthConnection {
  id: string;
  displayName: string;
  envUrl: string;
  tenantId: string;
  clientId: string;
}

export interface ElectronFnoAuthResult {
  accessToken: string;
  expiresAt: number;
  account: { username: string; tenantId: string; homeAccountId?: string; name?: string } | null;
  envUrl: string;
}

export interface ElectronAPI {
  openFileDialog: () => Promise<Array<{ path: string; content: string }> | null>;
  fnoAuth?: {
    login: (conn: ElectronFnoAuthConnection) => Promise<ElectronFnoAuthResult>;
    silent: (conn: ElectronFnoAuthConnection) => Promise<ElectronFnoAuthResult | null>;
    account: (conn: ElectronFnoAuthConnection) => Promise<ElectronFnoAuthResult['account']>;
    logout: (conn: ElectronFnoAuthConnection) => Promise<boolean>;
  };
  fnoRequest?: (payload: ElectronFnoRequest) => Promise<ElectronFnoResponse>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export function getElectronApi(): ElectronAPI | null {
  if (typeof window === 'undefined') return null;
  return window.electronAPI ?? null;
}

export function isElectronHost(): boolean {
  const api = getElectronApi();
  return Boolean(api?.fnoRequest && api?.fnoAuth);
}
