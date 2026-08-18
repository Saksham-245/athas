import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const providerFetchMock = vi.fn();
const openUrlMock = vi.fn();
const getProviderApiTokenMock = vi.fn();
const storeProviderApiTokenMock = vi.fn();
const removeProviderApiTokenMock = vi.fn();
const getProviderAuthMetaMock = vi.fn();
const storeProviderAuthMetaMock = vi.fn();
const removeProviderAuthMetaMock = vi.fn();

vi.mock("@/features/ai/services/providers/provider-fetch", () => ({
  providerFetch: (...args: unknown[]) => providerFetchMock(...args),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => openUrlMock(...args),
}));

vi.mock("@/features/ai/services/ai-token-service", () => ({
  getProviderApiToken: (...args: unknown[]) => getProviderApiTokenMock(...args),
  storeProviderApiToken: (...args: unknown[]) => storeProviderApiTokenMock(...args),
  removeProviderApiToken: (...args: unknown[]) => removeProviderApiTokenMock(...args),
  getProviderAuthMeta: (...args: unknown[]) => getProviderAuthMetaMock(...args),
  storeProviderAuthMeta: (...args: unknown[]) => storeProviderAuthMetaMock(...args),
  removeProviderAuthMeta: (...args: unknown[]) => removeProviderAuthMetaMock(...args),
}));

const {
  beginXaiDeviceLogin,
  waitForXaiDeviceToken,
  storeXaiTokenSet,
  getGrokBearerToken,
  XaiAuthError,
} = await import("@/features/ai/services/xai-auth-service");

describe("xai-auth-service", () => {
  beforeEach(() => {
    providerFetchMock.mockReset();
    openUrlMock.mockReset();
    getProviderApiTokenMock.mockReset();
    storeProviderApiTokenMock.mockReset();
    removeProviderApiTokenMock.mockReset();
    getProviderAuthMetaMock.mockReset();
    storeProviderAuthMetaMock.mockReset();
    removeProviderAuthMetaMock.mockReset();
  });

  it("parses a device login session", async () => {
    providerFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          device_code: "device-123",
          user_code: "ABCD-EFGH",
          verification_uri: "https://accounts.x.ai/oauth2/device",
          verification_uri_complete: "https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH",
          expires_in: 1800,
          interval: 5,
        }),
        { status: 200 },
      ),
    );

    const session = await beginXaiDeviceLogin();
    expect(session.deviceCode).toBe("device-123");
    expect(session.userCode).toBe("ABCD-EFGH");
    expect(session.verificationUriComplete).toContain("user_code=ABCD-EFGH");
    expect(session.intervalMs).toBe(5000);
  });

  it("polls until the device token is ready", async () => {
    providerFetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "openid api:access",
          }),
          { status: 200 },
        ),
      );

    const tokenSet = await waitForXaiDeviceToken({
      deviceCode: "device-123",
      userCode: "ABCD-EFGH",
      verificationUri: "https://accounts.x.ai/oauth2/device",
      verificationUriComplete: null,
      expiresAt: Date.now() + 30_000,
      intervalMs: 1,
    });

    expect(tokenSet.accessToken).toBe("access-token");
    expect(tokenSet.refreshToken).toBe("refresh-token");
  });

  it("stores oauth token metadata", async () => {
    await storeXaiTokenSet({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 10_000,
      scope: "openid api:access",
      tokenType: "Bearer",
    });

    expect(storeProviderApiTokenMock).toHaveBeenCalledWith("grok", "access-token");
    expect(storeProviderAuthMetaMock).toHaveBeenCalled();
    const meta = storeProviderAuthMetaMock.mock.calls[0]?.[1] as {
      credentialType?: string;
      refreshToken?: string;
    };
    expect(meta?.credentialType).toBe("oauth");
    expect(meta?.refreshToken).toBe("refresh-token");
  });

  it("returns stored oauth tokens without refresh when still valid", async () => {
    getProviderApiTokenMock.mockResolvedValueOnce("access-token");
    getProviderAuthMetaMock.mockResolvedValueOnce({
      credentialType: "oauth",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
      scope: "openid api:access",
      tokenType: "Bearer",
      clientId: "client",
      issuer: "https://auth.x.ai",
    });

    await expect(getGrokBearerToken()).resolves.toBe("access-token");
    expect(providerFetchMock).not.toHaveBeenCalled();
  });

  it("raises a typed error when device login is denied", async () => {
    providerFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "access_denied" }), { status: 400 }),
    );

    await expect(
      waitForXaiDeviceToken({
        deviceCode: "device-123",
        userCode: "ABCD-EFGH",
        verificationUri: "https://accounts.x.ai/oauth2/device",
        verificationUriComplete: null,
        expiresAt: Date.now() + 30_000,
        intervalMs: 1,
      }),
    ).rejects.toBeInstanceOf(XaiAuthError);
  });
});
