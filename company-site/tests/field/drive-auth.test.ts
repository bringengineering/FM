import { describe, expect, it, vi } from "vitest";

import {
  DriveTokenManager,
  type GoogleTokenClient,
} from "../../app/field/lib/drive-auth.client";

describe("DriveTokenManager", () => {
  it("adopts a Firebase Google popup access token without persisting it", () => {
    const manager = new DriveTokenManager({
      clientId: "client-id",
      scope: "scope",
      now: () => 1_000,
      loadIdentityServices: async () => ({
        initTokenClient: vi.fn(),
      }),
    });

    manager.adoptAccessToken("firebase-popup-token", 3_600);

    expect(manager.getAccessToken()).toBe("firebase-popup-token");
    expect(manager.snapshot()).toEqual({
      status: "connected",
      expiresAt: 3_541_000,
    });
    expect(localStorage.length).toBe(0);
  });

  it("keeps the OAuth token in memory and reports connected state", async () => {
    const client: GoogleTokenClient = {
      callback: () => undefined,
      requestAccessToken: vi.fn(() => client.callback({
        access_token: "access-token",
        expires_in: 3600,
      })),
    };
    const initTokenClient = vi.fn((config) => {
      client.callback = config.callback;
      return client;
    });
    const manager = new DriveTokenManager({
      clientId: "client-id",
      scope: "scope",
      now: () => 1_000,
      loadIdentityServices: async () => ({
        initTokenClient,
      }),
    });

    await expect(manager.connect()).resolves.toBe("access-token");
    expect(manager.snapshot()).toMatchObject({ status: "connected" });
    expect(manager.getAccessToken()).toBe("access-token");
    expect(client.requestAccessToken).toHaveBeenCalledWith({ prompt: "" });
    expect(initTokenClient).toHaveBeenCalledWith(expect.objectContaining({
      login_hint: "bringengineering1008@gmail.com",
      include_granted_scopes: true,
    }));
  });

  it("silently reacquires a previously granted token without showing consent", async () => {
    const client: GoogleTokenClient = {
      callback: () => undefined,
      requestAccessToken: vi.fn(() => client.callback({
        access_token: "silent-token",
        expires_in: 3600,
      })),
    };
    const manager = new DriveTokenManager({
      clientId: "client-id",
      scope: "scope",
      loadIdentityServices: async () => ({
        initTokenClient(config) {
          client.callback = config.callback;
          return client;
        },
      }),
    });

    await expect(manager.connect("")).resolves.toBe("silent-token");
    expect(client.requestAccessToken).toHaveBeenCalledWith({ prompt: "" });
  });

  it("defaults repeat connections to the previously granted account without consent", async () => {
    const client: GoogleTokenClient = {
      callback: () => undefined,
      requestAccessToken: vi.fn(() => client.callback({
        access_token: "repeat-token",
        expires_in: 3600,
      })),
    };
    const manager = new DriveTokenManager({
      clientId: "client-id",
      scope: "scope",
      loadIdentityServices: async () => ({
        initTokenClient(config) {
          client.callback = config.callback;
          return client;
        },
      }),
    });

    await manager.connect();

    expect(client.requestAccessToken).toHaveBeenCalledWith({ prompt: "" });
  });

  it("never persists expired access tokens", async () => {
    let now = 1_000;
    const client: GoogleTokenClient = {
      callback: () => undefined,
      requestAccessToken: () => client.callback({ access_token: "short", expires_in: 120 }),
    };
    const manager = new DriveTokenManager({
      clientId: "client-id",
      scope: "scope",
      now: () => now,
      loadIdentityServices: async () => ({
        initTokenClient(config) {
          client.callback = config.callback;
          return client;
        },
      }),
    });
    await manager.connect();
    now += 70_000;

    expect(manager.getAccessToken()).toBeNull();
    expect(manager.snapshot().status).toBe("disconnected");
    expect(localStorage.length).toBe(0);
  });

  it("maps OAuth denial without retaining provider details", async () => {
    const client: GoogleTokenClient = {
      callback: () => undefined,
      requestAccessToken: () => client.callback({ error: "access_denied", error_description: "raw secret" }),
    };
    const manager = new DriveTokenManager({
      clientId: "client-id",
      scope: "scope",
      loadIdentityServices: async () => ({
        initTokenClient(config) {
          client.callback = config.callback;
          return client;
        },
      }),
    });

    await expect(manager.connect()).rejects.toThrow("drive_authorization_denied");
    expect(manager.snapshot()).toEqual({ status: "error", error: "drive_authorization_denied" });
  });

  it("settles with an actionable error when Google cannot open the consent popup", async () => {
    let errorCallback: (() => void) | undefined;
    const client: GoogleTokenClient = {
      callback: () => undefined,
      requestAccessToken: () => errorCallback?.(),
    };
    const manager = new DriveTokenManager({
      clientId: "client-id",
      scope: "scope",
      loadIdentityServices: async () => ({
        initTokenClient(config) {
          client.callback = config.callback;
          errorCallback = config.error_callback;
          return client;
        },
      }),
    });

    await expect(manager.connect()).rejects.toThrow("drive_authorization_failed");
    expect(manager.snapshot()).toEqual({
      status: "error",
      error: "drive_authorization_failed",
    });
  });
});
