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
  /**
   * Component type of this tree node, when known. On F&O the same
   * `ERSolutionTable` row represents both "solutions" and individual
   * configurations — the `ComponentType` column distinguishes them.
   * We surface this so UI code can filter (e.g. show only DataModel
   * roots in the left panel).
   */
  componentType?: ErComponentType;
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
  /**
   * Whether this node has children in the ER hierarchy. UI uses this
   * to show drill-in affordance. Populated from `DerivedSolutions`.
   */
  hasChildren?: boolean;
  /**
   * GUID of the owning/parent DataModel. Populated when the component
   * is discovered as a descendant of a DataModel node in the ER tree.
   * Required by F&O's `GetModelMappingByID` (which expects
   * `_dataModelGuid` alongside the mapping id) and useful for
   * `GetDataModelByIDAndRevision` when the component itself is a
   * derived DataModel.
   */
  parentDataModelGuid?: string;
  /** Owning DataModel's revision GUID, when known (sibling of above). */
  parentDataModelRevisionGuid?: string;
  /**
   * All known numeric revision numbers reported by F&O's
   * `getFormatSolutionsSubHierarchy` in the component's `Versions[]`
   * array. Used by `GetDataModelByIDAndRevision` (and siblings) which
   * need a *specific* integer revision — picking just the max fails
   * for configurations whose XML was authored on an earlier revision
   * while later ones are empty pointers. The downloader tries them
   * high → low.
   */
  versionNumbers?: number[];
  /**
   * Ordered list of DataModel configurationGuids that make up the
   * ancestor chain for this component. The root of the ER tree comes
   * first; the nearest parent DataModel comes last. Populated by the
   * UI during drill navigation so `handleLoadSelected` can auto-queue
   * every model the Format / Mapping was nested under — without that,
   * derived-model references in the bindings resolve to nothing.
   */
  ancestorDataModelGuids?: string[];
}

/** Result of downloading a configuration XML. */
export interface ErConfigDownload {
  /** The ingested XML content as UTF-8 string (already BOM-stripped). */
  xml: string;
  /** The synthetic path used as `filePath` when pushing into the store. */
  syntheticPath: string;
  /** The source config metadata for UI feedback. */
  source: ErConfigSummary;
  /**
   * GUIDs of any DataModel(s) referenced from inside the downloaded
   * XML — e.g. `ERFormatMapping.Model` or `ERModelMapping.Model`
   * attribute. When `getFormatSolutionsSubHierarchy` didn't expose a
   * real DataModel GUID (returns zero placeholder for ModelMapping /
   * derived DataModel rows), these are the only way we can follow-up
   * with `GetDataModelByIDAndRevision` to fetch the model tree.
   */
  referencedDataModelGuids?: string[];
  /**
   * Highest revision number referenced from inside the downloaded XML
   * (e.g. `ERFormatMapping.ModelVersion = "{guid},42"`). Pairs with
   * `referencedDataModelGuids` so the caller can pass a specific
   * revision to `GetDataModelByIDAndRevision`.
   */
  referencedDataModelRevisions?: Record<string, number>;
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
  /**
   * POST a JSON body and parse the JSON response. Used for F&O custom
   * services (`/api/services/<group>/<service>/<operation>`). Throws
   * `FnoHttpError` on non-2xx.
   */
  postJson<T = unknown>(
    url: string,
    token: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T>;
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

/**
 * Raised when F&O accepts the download request syntactically (HTTP 200)
 * but returns an empty body. Typical for derived DataModel components
 * that have no XML of their own — they inherit everything from the
 * base model. Callers can treat this distinctly from a real failure
 * (e.g. silently skip auto-included root models that turn out to be
 * derived, or show an info message instead of an error).
 */
export class FnoEmptyContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FnoEmptyContentError';
  }
}

export class FnoAuthError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'FnoAuthError';
  }
}
