"use client";

export const GOOGLE_DRIVE_CLIENT_ID = "864976295990-v3i2np17n2n7nu0mu27hc6ol3rk76hd0.apps.googleusercontent.com";
export const BRING_COMPANY_GOOGLE_ACCOUNT = "bringengineering1008@gmail.com";
export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive";
export const GOOGLE_DRIVE_SCOPE = `openid email profile ${GOOGLE_DRIVE_FILE_SCOPE}`;

type TokenResponse = Record<string, unknown>;

export interface GoogleTokenClient {
  callback: (response: TokenResponse) => void;
  requestAccessToken(options?: { prompt?: string }): void;
}

export interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    login_hint?: string;
    include_granted_scopes?: boolean;
    callback: (response: TokenResponse) => void;
    error_callback?: () => void;
  }): GoogleTokenClient;
}

export type DriveConnectionSnapshot =
  | { status: "disconnected" }
  | { status: "connecting" }
  | { status: "connected"; expiresAt: number }
  | { status: "error"; error: string };

export interface DriveTokenManagerOptions {
  clientId: string;
  scope: string;
  now?: () => number;
  loadIdentityServices: () => Promise<GoogleOAuth2>;
}

const TOKEN_EXPIRY_SAFETY_MS = 60_000;

export class DriveTokenManager {
  private readonly options: DriveTokenManagerOptions;
  private accessToken: string | null = null;
  private expiresAt = 0;
  private tokenClient: GoogleTokenClient | null = null;
  private state: DriveConnectionSnapshot = { status: "disconnected" };
  private readonly listeners = new Set<() => void>();
  private pending: Promise<string> | null = null;
  private pendingReject: ((error: Error) => void) | null = null;

  constructor(options: DriveTokenManagerOptions) {
    this.options = options;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private setState(state: DriveConnectionSnapshot): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  snapshot = (): DriveConnectionSnapshot => {
    if (this.state.status === "connected" && !this.getAccessToken()) {
      return { status: "disconnected" };
    }
    return this.state;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getAccessToken = (): string | null => {
    if (!this.accessToken || this.now() >= this.expiresAt) {
      this.accessToken = null;
      this.expiresAt = 0;
      if (this.state.status === "connected") this.setState({ status: "disconnected" });
      return null;
    }
    return this.accessToken;
  };

  disconnect(): void {
    this.accessToken = null;
    this.expiresAt = 0;
    this.setState({ status: "disconnected" });
  }

  adoptAccessToken(accessToken: string, expiresInSeconds = 3_600): void {
    const token = accessToken.trim();
    if (!token || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
      throw new Error("drive_authorization_failed");
    }
    this.accessToken = token;
    this.expiresAt = this.now()
      + Math.max(0, expiresInSeconds * 1_000 - TOKEN_EXPIRY_SAFETY_MS);
    this.setState({ status: "connected", expiresAt: this.expiresAt });
  }

  async connect(prompt = ""): Promise<string> {
    const existing = this.getAccessToken();
    if (existing) return existing;
    if (this.pending) return this.pending;
    this.setState({ status: "connecting" });
    this.pending = this.requestToken(prompt).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async requestToken(prompt: string): Promise<string> {
    try {
      if (!this.tokenClient) {
        const oauth2 = await this.options.loadIdentityServices();
        this.tokenClient = oauth2.initTokenClient({
          client_id: this.options.clientId,
          scope: this.options.scope,
          login_hint: BRING_COMPANY_GOOGLE_ACCOUNT,
          include_granted_scopes: true,
          callback: () => undefined,
          error_callback: () => {
            const code = "drive_authorization_failed";
            this.setState({ status: "error", error: code });
            const reject = this.pendingReject;
            this.pendingReject = null;
            reject?.(new Error(code));
          },
        });
      }
      return await new Promise<string>((resolve, reject) => {
        const client = this.tokenClient;
        if (!client) {
          reject(new Error("drive_identity_unavailable"));
          return;
        }
        this.pendingReject = reject;
        client.callback = (response) => {
          this.pendingReject = null;
          const token = typeof response.access_token === "string" ? response.access_token : "";
          const expiresIn = typeof response.expires_in === "number"
            ? response.expires_in
            : Number(response.expires_in);
          if (!token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
            const code = response.error === "access_denied"
              ? "drive_authorization_denied"
              : "drive_authorization_failed";
            this.setState({ status: "error", error: code });
            reject(new Error(code));
            return;
          }
          this.accessToken = token;
          this.expiresAt = this.now() + Math.max(0, expiresIn * 1_000 - TOKEN_EXPIRY_SAFETY_MS);
          this.setState({ status: "connected", expiresAt: this.expiresAt });
          resolve(token);
        };
        try {
          client.requestAccessToken({ prompt });
        } catch {
          this.pendingReject = null;
          this.setState({ status: "error", error: "drive_authorization_failed" });
          reject(new Error("drive_authorization_failed"));
        }
      });
    } catch (error) {
      const code = error instanceof Error && error.message.startsWith("drive_")
        ? error.message
        : "drive_identity_unavailable";
      this.setState({ status: "error", error: code });
      throw new Error(code);
    }
  }
}

let identityPromise: Promise<GoogleOAuth2> | null = null;

export function loadGoogleIdentityServices(): Promise<GoogleOAuth2> {
  if (identityPromise) return identityPromise;
  identityPromise = new Promise<GoogleOAuth2>((resolve, reject) => {
    const globalGoogle = globalThis as typeof globalThis & {
      google?: { accounts?: { oauth2?: GoogleOAuth2 } };
    };
    const ready = globalGoogle.google?.accounts?.oauth2;
    if (ready) {
      resolve(ready);
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>("script[data-bring-google-identity]");
    const script = existing ?? document.createElement("script");
    const timeout = window.setTimeout(() => reject(new Error("drive_identity_unavailable")), 15_000);
    script.addEventListener("load", () => {
      window.clearTimeout(timeout);
      const oauth2 = globalGoogle.google?.accounts?.oauth2;
      if (oauth2) resolve(oauth2);
      else reject(new Error("drive_identity_unavailable"));
    }, { once: true });
    script.addEventListener("error", () => {
      window.clearTimeout(timeout);
      reject(new Error("drive_identity_unavailable"));
    }, { once: true });
    if (!existing) {
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.bringGoogleIdentity = "true";
      document.head.append(script);
    }
  }).catch((error) => {
    identityPromise = null;
    throw error;
  });
  return identityPromise!;
}

export const driveTokenManager = new DriveTokenManager({
  clientId: GOOGLE_DRIVE_CLIENT_ID,
  scope: GOOGLE_DRIVE_SCOPE,
  loadIdentityServices: loadGoogleIdentityServices,
});
