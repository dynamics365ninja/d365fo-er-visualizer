// ─── Public domain types for the F&O connector ───

/** A single connection profile the user has configured (no secrets). */
export interface FnoConnection {
  /** Stable id for persistence. */
  id: string;
  /** Human-friendly name shown in UI. */
  displayName: string;
  /** Full environment URL, e.g. `https://orgabc.sandbox.operations.dynamics.com`. */
  envUrl: string;
  /** Microsoft Entra tenant id (GUID or domain). */
  tenantId: string;
  /** Application (client) id of the registered Entra app. */
  clientId: string;
  /** Optional timestamp (ms since epoch) of last successful use. */
  lastUsedAt?: number;
  /** Creation time (ms since epoch). */
  createdAt: number;
}

/** ER solution row returned from `ERSolutionEntity`. */
export interface ErSolutionSummary {
  /** Primary key — used to scope component listing. */
  solutionName: string;
  publisher?: string;
  version?: string;
  /** Display name for the solution, if distinct from `solutionName`. */
  displayName?: string;
}

export type ErComponentType = 'DataModel' | 'ModelMapping' | 'Format' | 'Unknown';

/** ER configuration/component row from `ERSolutionComponentEntity`. */
export interface ErConfigSummary {
  /** Owning solution. */
  solutionName: string;
  /** Name of the configuration. */
  configurationName: string;
  componentType: ErComponentType;
  /** Version as reported by F&O (string; e.g. `"1.3"` or `"252"`). */
  version?: string;
  /** GUID of the configuration revision that holds the XML content. */
  revisionGuid?: string;
  /** Optional GUID of the configuration itself (different from the revision). */
  configurationGuid?: string;
  /** Country / region code if exposed. */
  countryRegion?: string;
  /** Whether the component has downstream XML content available. */
  hasContent: boolean;
}

/** Result of downloading a configuration XML. */
export interface ErConfigDownload {
  /** The ingested XML content as UTF-8 string (already BOM-stripped). */
  xml: string;
  /** The synthetic path used as `filePath` when pushing into the store. */
  syntheticPath: string;
  /** The source config metadata for UI feedback. */
  source: ErConfigSummary;
}

/** A successfully acquired token, valid for an envUrl. */
export interface AuthResult {
  accessToken: string;
  /** Epoch ms when the token expires (local clock). */
  expiresAt: number;
  /** Signed-in account identity, if known. */
  account?: AuthAccount;
  /** The envUrl the token was scoped to. */
  envUrl: string;
}

export interface AuthAccount {
  username: string;
  tenantId: string;
  /** Local account id (MSAL homeAccountId). */
  homeAccountId?: string;
  name?: string;
}

/** HTTP transport abstraction implemented per host (Electron / Browser). */
export interface FnoTransport {
  /** Fetch JSON, returning parsed body. Throws `FnoHttpError` on non-2xx. */
  getJson<T = unknown>(url: string, token: string, signal?: AbortSignal): Promise<T>;
  /**
   * Fetch raw body as an ArrayBuffer. Used for binary / base64-encoded payloads.
   * Throws `FnoHttpError` on non-2xx.
   */
  getBinary(url: string, token: string, signal?: AbortSignal): Promise<ArrayBuffer>;
}

/** Auth provider abstraction — token acquisition per host. */
export interface AuthProvider {
  /** Acquire an access token for the given connection. Interactive if needed. */
  acquireToken(conn: FnoConnection, signal?: AbortSignal): Promise<AuthResult>;
  /** Sign out (clear cached tokens) for the given connection. */
  signOut(conn: FnoConnection): Promise<void>;
  /** Return cached account info if any, without triggering interactive flow. */
  getAccount(conn: FnoConnection): Promise<AuthAccount | null>;
}

// ─── Errors ───

export class FnoHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'FnoHttpError';
  }
}

export class FnoSourceUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FnoSourceUnsupportedError';
  }
}

export class FnoAuthError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'FnoAuthError';
  }
}
