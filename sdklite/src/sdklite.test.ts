import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────

const mockPost = vi.fn();
const mockGet = vi.fn();
const mockPut = vi.fn();

vi.mock("axios", () => {
  const actual = { isAxiosError: (e: any) => e?.isAxiosError === true };
  return {
    default: {
      ...actual,
      create: () => ({ post: mockPost, get: mockGet, put: mockPut }),
      isAxiosError: actual.isAxiosError,
    },
    isAxiosError: actual.isAxiosError,
  };
});

const mockPi = {
  authenticate: vi.fn(),
  nativeFeaturesList: vi.fn(),
  createPayment: vi.fn(),
  Ads: {
    isAdReady: vi.fn(),
    requestAd: vi.fn(),
    showAd: vi.fn(),
  },
};

(globalThis as any).Pi = mockPi;
(globalThis as any).window = { ...(globalThis as any).window };

// ── Import under test (after mocks are in place) ──────────────────

// Dynamic import so the module sees our mocked globals
const loadSDK = async () => {
  await import("./sdklite");
  return (window as any).SDKLite;
};

// ── Helpers ────────────────────────────────────────────────────────

function axiosError(status: number) {
  return { isAxiosError: true, response: { status } };
}

const FAKE_TOKEN = "pi-access-token-xyz";

const FAKE_OFFER: { offerId: string; amount: number; memo: string } = {
  offerId: "offer-1",
  amount: 3.14,
  memo: "Pay for Boost x2",
};

/** Stubs Pi.authenticate + backend login so sdk.login() succeeds. */
function stubSuccessfulLogin() {
  mockPi.authenticate.mockResolvedValue({
    user: { uid: "user-1" },
    accessToken: FAKE_TOKEN,
  });
  mockPost.mockResolvedValueOnce({ status: 200, data: {} }); // POST /v1/login
}

/** Stubs login + a successful POST /v1/offers response. */
function stubLoginAndOffer() {
  stubSuccessfulLogin();
  mockPost.mockResolvedValueOnce({ status: 201, data: FAKE_OFFER }); // POST /v1/offers
}

// ── Tests ──────────────────────────────────────────────────────────

describe("SDKLite", () => {
  let SDKLite: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-import to get a fresh module
    SDKLite = await loadSDK();
  });

  // ── init ──

  describe("init", () => {
    it("returns an SDKLiteInstance with expected public methods", async () => {
      const sdk = await SDKLite.init();
      expect(sdk).toBeDefined();
      expect(typeof sdk.login).toBe("function");
      expect(typeof sdk.makePurchase).toBe("function");
      expect(typeof sdk.state.get).toBe("function");
      expect(typeof sdk.state.set).toBe("function");
      expect(typeof sdk.state.purchases).toBe("function");
      expect(typeof sdk.state.consume).toBe("function");
      expect(typeof sdk.showInterstitial).toBe("function");
      expect(typeof sdk.showRewarded).toBe("function");
      expect(typeof sdk.isAdNetworkSupported).toBe("function");
    });
  });

  describe("state", () => {
    it("gets user state via state.get", async () => {
      const sdk = await SDKLite.init();
      stubSuccessfulLogin();
      mockGet.mockResolvedValueOnce({
        status: 200,
        data: { blob: { level: 6 }, updatedAt: "2026-02-19T00:00:00Z", version: 4 },
      });

      const result = await sdk.state.get("progress");

      expect(result).toEqual({
        blob: { level: 6 },
        updatedAt: "2026-02-19T00:00:00Z",
        version: 4,
      });
      expect(mockGet).toHaveBeenCalledWith(
        "/v1/user-state/progress",
        expect.objectContaining({ headers: { Authorization: `Bearer ${FAKE_TOKEN}` } })
      );
    });

    it("returns null when state key is missing", async () => {
      const sdk = await SDKLite.init();
      stubSuccessfulLogin();
      mockGet.mockRejectedValueOnce(axiosError(404));

      await expect(sdk.state.get("missing-key")).resolves.toBeNull();
    });

    it("sets user state via state.set", async () => {
      const sdk = await SDKLite.init();
      stubSuccessfulLogin();
      mockPut.mockResolvedValueOnce({ status: 204 });

      await expect(sdk.state.set("progress", { level: 7 })).resolves.toBeUndefined();
      expect(mockPut).toHaveBeenCalledWith(
        "/v1/user-state/progress",
        { blob: { level: 7 } },
        expect.objectContaining({ headers: { Authorization: `Bearer ${FAKE_TOKEN}` } })
      );
    });

    it("gets purchases and returns payload", async () => {
      const sdk = await SDKLite.init();
      stubSuccessfulLogin();
      mockGet.mockResolvedValueOnce({
        status: 200,
        data: { purchases: [{ productId: "extra-life", quantity: 3 }] },
      });

      const result = await sdk.state.purchases();

      expect(result).toEqual({
        purchases: [{ productId: "extra-life", quantity: 3 }],
      });
      expect(mockGet).toHaveBeenCalledWith(
        "/v1/purchases",
        expect.objectContaining({ headers: { Authorization: `Bearer ${FAKE_TOKEN}` } })
      );
    });

    it("consumes purchase with explicit quantity", async () => {
      const sdk = await SDKLite.init();
      stubSuccessfulLogin();
      mockPost.mockResolvedValueOnce({
        status: 200,
        data: { productId: "extra-life", quantity: 2 },
      });

      const result = await sdk.state.consume("extra-life", 1);

      expect(result).toEqual({ productId: "extra-life", quantity: 2 });
      expect(mockPost).toHaveBeenCalledWith(
        "/v1/purchases/consume",
        { productId: "extra-life", quantity: 1 },
        expect.objectContaining({ headers: { Authorization: `Bearer ${FAKE_TOKEN}` } })
      );
    });

    it("consumes purchase with default quantity payload", async () => {
      const sdk = await SDKLite.init();
      stubSuccessfulLogin();
      mockPost.mockResolvedValueOnce({
        status: 200,
        data: { productId: "extra-life", quantity: 1 },
      });

      await sdk.state.consume("extra-life");

      expect(mockPost).toHaveBeenCalledWith(
        "/v1/purchases/consume",
        { productId: "extra-life" },
        expect.objectContaining({ headers: { Authorization: `Bearer ${FAKE_TOKEN}` } })
      );
    });

    it("passes through consume validation errors", async () => {
      const sdk = await SDKLite.init();
      stubSuccessfulLogin();
      mockPost.mockRejectedValueOnce(axiosError(422));

      await expect(sdk.state.consume("extra-life", 99)).rejects.toMatchObject({
        isAxiosError: true,
        response: { status: 422 },
      });
    });

    it("throws when purchases access login fails", async () => {
      const sdk = await SDKLite.init();
      mockPi.authenticate.mockResolvedValue({ user: null, accessToken: null });

      await expect(sdk.state.purchases()).rejects.toThrow(
        "Unable to authenticate user for purchases access."
      );
    });
  });

  // ── login ──

  describe("login", () => {
    it("authenticates via Pi SDK and posts to backend", async () => {
      const sdk = await SDKLite.init();
      stubSuccessfulLogin();

      const result = await sdk.login();

      expect(result).toBe(true);
      expect(mockPi.authenticate).toHaveBeenCalledWith(
        ["username", "payments"],
        expect.any(Function)
      );
      expect(mockPost).toHaveBeenCalledWith("/v1/login", {
        pi_auth_token: FAKE_TOKEN,
      });
    });

    it("returns true immediately if already logged in", async () => {
      const sdk = await SDKLite.init();
      stubSuccessfulLogin();
      await sdk.login();

      const again = await sdk.login();
      expect(again).toBe(true);
      expect(mockPi.authenticate).toHaveBeenCalledTimes(1);
    });

    it("returns false when Pi.authenticate gives no user", async () => {
      const sdk = await SDKLite.init();
      mockPi.authenticate.mockResolvedValue({ user: null, accessToken: null });

      expect(await sdk.login()).toBe(false);
    });

    it("returns false when Pi.authenticate gives no accessToken", async () => {
      const sdk = await SDKLite.init();
      mockPi.authenticate.mockResolvedValue({
        user: { uid: "u1" },
        accessToken: undefined,
      });

      expect(await sdk.login()).toBe(false);
    });

    it("returns false when backend login POST throws", async () => {
      const sdk = await SDKLite.init();
      mockPi.authenticate.mockResolvedValue({
        user: { uid: "u1" },
        accessToken: FAKE_TOKEN,
      });
      mockPost.mockRejectedValueOnce(new Error("network error"));

      expect(await sdk.login()).toBe(false);
    });
  });

  // ── isAdNetworkSupported ──

  describe("isAdNetworkSupported", () => {
    it("returns true when ad_network is in native features", async () => {
      const sdk = await SDKLite.init();
      mockPi.nativeFeaturesList.mockResolvedValue(["ad_network", "other"]);

      expect(await sdk.isAdNetworkSupported()).toBe(true);
    });

    it("returns false when ad_network is missing", async () => {
      const sdk = await SDKLite.init();
      mockPi.nativeFeaturesList.mockResolvedValue(["other_feature"]);

      expect(await sdk.isAdNetworkSupported()).toBe(false);
    });

    it("caches the result after first true check", async () => {
      const sdk = await SDKLite.init();
      mockPi.nativeFeaturesList.mockResolvedValue(["ad_network"]);

      await sdk.isAdNetworkSupported();
      await sdk.isAdNetworkSupported();

      expect(mockPi.nativeFeaturesList).toHaveBeenCalledTimes(1);
    });
  });

  // ── makePurchase ──

  describe("makePurchase", () => {
    it("throws purchase_error when login fails", async () => {
      const sdk = await SDKLite.init();
      mockPi.authenticate.mockResolvedValue({ user: null, accessToken: null });

      await expect(sdk.makePurchase("prod-1")).rejects.toMatchObject({
        name: "SDKLiteError",
        code: "purchase_error",
      });
    });

    it("throws product_not_found when offer creation gets 404", async () => {
      const sdk = await SDKLite.init();
      stubSuccessfulLogin();

      mockPost.mockRejectedValueOnce(axiosError(404)); // POST /v1/offers → 404

      await expect(sdk.makePurchase("bad-product")).rejects.toMatchObject({
        name: "SDKLiteError",
        code: "product_not_found",
      });
    });

    it("throws purchase_error when offer payload is invalid", async () => {
      const sdk = await SDKLite.init();
      stubSuccessfulLogin();

      mockPost.mockResolvedValueOnce({
        status: 201,
        data: { offerId: "o1" }, // missing amount and memo
      });

      await expect(sdk.makePurchase("prod-1")).rejects.toMatchObject({
        code: "purchase_error",
      });
    });

    it("resolves with PurchaseResult on successful payment flow", async () => {
      const sdk = await SDKLite.init();
      stubLoginAndOffer();

      // Capture callbacks from createPayment and drive them
      mockPi.createPayment.mockImplementation((_data: any, cbs: any) => {
        cbs.onReadyForServerApproval("pay-1");
        cbs.onReadyForServerCompletion("pay-1", "txid-abc");
      });

      mockPost.mockResolvedValueOnce({ status: 200 }); // approve
      mockPost.mockResolvedValueOnce({ status: 200 }); // complete

      const result = await sdk.makePurchase("prod-1");

      expect(result).toEqual({
        ok: true,
        productId: "prod-1",
        paymentId: "pay-1",
        txid: "txid-abc",
      });
    });

    it("passes offer-derived paymentData to Pi.createPayment", async () => {
      const sdk = await SDKLite.init();
      stubLoginAndOffer();

      mockPi.createPayment.mockImplementation((_data: any, cbs: any) => {
        cbs.onReadyForServerCompletion("pay-1", "txid-abc");
      });
      mockPost.mockResolvedValue({ status: 200 });

      await sdk.makePurchase("prod-1");

      expect(mockPi.createPayment).toHaveBeenCalledWith(
        {
          amount: FAKE_OFFER.amount,
          memo: FAKE_OFFER.memo,
          metadata: { productId: "prod-1", offerId: FAKE_OFFER.offerId },
        },
        expect.any(Object)
      );
    });

    it("rejects with purchase_cancelled when user cancels", async () => {
      const sdk = await SDKLite.init();
      stubLoginAndOffer();

      mockPi.createPayment.mockImplementation((_data: any, cbs: any) => {
        cbs.onCancel();
      });

      await expect(sdk.makePurchase("prod-1")).rejects.toMatchObject({
        code: "purchase_cancelled",
      });
    });

    it("rejects with purchase_error when Pi SDK errors", async () => {
      const sdk = await SDKLite.init();
      stubLoginAndOffer();

      mockPi.createPayment.mockImplementation((_data: any, cbs: any) => {
        cbs.onError();
      });

      await expect(sdk.makePurchase("prod-1")).rejects.toMatchObject({
        code: "purchase_error",
      });
    });

    it("rejects with purchase_error when createPayment throws", async () => {
      const sdk = await SDKLite.init();
      stubLoginAndOffer();

      mockPi.createPayment.mockImplementation(() => {
        throw new Error("SDK crash");
      });

      await expect(sdk.makePurchase("prod-1")).rejects.toMatchObject({
        code: "purchase_error",
      });
    });

    it("rejects with purchase_error when approval POST fails", async () => {
      const sdk = await SDKLite.init();
      stubLoginAndOffer();

      mockPi.createPayment.mockImplementation((_data: any, cbs: any) => {
        cbs.onReadyForServerApproval("pay-1");
      });
      mockPost.mockRejectedValueOnce(new Error("approve failed"));

      await expect(sdk.makePurchase("prod-1")).rejects.toMatchObject({
        code: "purchase_error",
      });
    });

    it("rejects with purchase_error when complete POST returns non-200", async () => {
      const sdk = await SDKLite.init();
      stubLoginAndOffer();

      mockPi.createPayment.mockImplementation((_data: any, cbs: any) => {
        cbs.onReadyForServerCompletion("pay-1", "txid-abc");
      });
      mockPost.mockResolvedValueOnce({ status: 500 });

      await expect(sdk.makePurchase("prod-1")).rejects.toMatchObject({
        code: "purchase_error",
      });
    });

    it("settles only once even if multiple callbacks fire", async () => {
      const sdk = await SDKLite.init();
      stubLoginAndOffer();

      let capturedCallbacks: any;
      mockPi.createPayment.mockImplementation((_data: any, cbs: any) => {
        capturedCallbacks = cbs;
        cbs.onReadyForServerCompletion("pay-1", "txid-abc");
      });
      mockPost.mockResolvedValue({ status: 200 });

      const result = await sdk.makePurchase("prod-1");
      expect(result.ok).toBe(true);

      capturedCallbacks.onCancel();
      capturedCallbacks.onError();
    });
  });

  // ── showInterstitial ──

  describe("showInterstitial", () => {
    function setupAdSupported() {
      stubSuccessfulLogin();
      mockPi.nativeFeaturesList.mockResolvedValue(["ad_network"]);
    }

    it("returns true when ad is shown and closed", async () => {
      const sdk = await SDKLite.init();
      setupAdSupported();

      mockPi.Ads.isAdReady.mockResolvedValue(true);
      mockPi.Ads.showAd.mockResolvedValue({
        type: "interstitial",
        result: "AD_CLOSED",
      });

      expect(await sdk.showInterstitial()).toBe(true);
    });

    it("requests ad when not ready, then shows", async () => {
      const sdk = await SDKLite.init();
      setupAdSupported();

      mockPi.Ads.isAdReady.mockResolvedValue(false);
      mockPi.Ads.requestAd.mockResolvedValue(undefined);
      mockPi.Ads.showAd.mockResolvedValue({
        type: "interstitial",
        result: "AD_CLOSED",
      });

      expect(await sdk.showInterstitial()).toBe(true);
      expect(mockPi.Ads.requestAd).toHaveBeenCalledWith("interstitial");
    });

    it("returns false when login fails", async () => {
      const sdk = await SDKLite.init();
      mockPi.authenticate.mockResolvedValue({ user: null, accessToken: null });

      expect(await sdk.showInterstitial()).toBe(false);
    });

    it("returns false when ad network is not supported", async () => {
      const sdk = await SDKLite.init();
      stubSuccessfulLogin();
      mockPi.nativeFeaturesList.mockResolvedValue([]);

      expect(await sdk.showInterstitial()).toBe(false);
    });

    it("returns false when showAd result is not AD_CLOSED", async () => {
      const sdk = await SDKLite.init();
      setupAdSupported();

      mockPi.Ads.isAdReady.mockResolvedValue(true);
      mockPi.Ads.showAd.mockResolvedValue({
        type: "interstitial",
        result: "AD_DISPLAY_ERROR",
      });

      expect(await sdk.showInterstitial()).toBe(false);
    });
  });

  // ── showRewarded ──

  describe("showRewarded", () => {
    function setupAdSupported() {
      stubSuccessfulLogin();
      mockPi.nativeFeaturesList.mockResolvedValue(["ad_network"]);
    }

    it("returns true when ad is rewarded and backend confirms", async () => {
      const sdk = await SDKLite.init();
      setupAdSupported();

      mockPi.Ads.isAdReady.mockResolvedValue({ ready: true });
      mockPi.Ads.showAd.mockResolvedValue({
        type: "rewarded",
        result: "AD_REWARDED",
        adId: "ad-100",
      });
      mockGet.mockResolvedValueOnce({ data: { issued: true, granted: true } });

      expect(await sdk.showRewarded("extra-life")).toBe(true);
    });

    it("requests ad when not ready and proceeds if loaded", async () => {
      const sdk = await SDKLite.init();
      setupAdSupported();

      mockPi.Ads.isAdReady.mockResolvedValue({ ready: false });
      mockPi.Ads.requestAd.mockResolvedValue("AD_LOADED");
      mockPi.Ads.showAd.mockResolvedValue({
        type: "rewarded",
        result: "AD_REWARDED",
        adId: "ad-100",
      });
      mockGet.mockResolvedValueOnce({ data: { issued: true, granted: true } });

      expect(await sdk.showRewarded("extra-life")).toBe(true);
    });

    it("returns false when requestAd does not return AD_LOADED", async () => {
      const sdk = await SDKLite.init();
      setupAdSupported();

      mockPi.Ads.isAdReady.mockResolvedValue({ ready: false });
      mockPi.Ads.requestAd.mockResolvedValue("AD_NOT_AVAILABLE");

      expect(await sdk.showRewarded("extra-life")).toBe(false);
    });

    it("returns false when showAd result is not AD_REWARDED", async () => {
      const sdk = await SDKLite.init();
      setupAdSupported();

      mockPi.Ads.isAdReady.mockResolvedValue({ ready: true });
      mockPi.Ads.showAd.mockResolvedValue({
        type: "rewarded",
        result: "AD_CLOSED",
      });

      expect(await sdk.showRewarded("extra-life")).toBe(false);
    });

    it("returns false when showAd has no adId", async () => {
      const sdk = await SDKLite.init();
      setupAdSupported();

      mockPi.Ads.isAdReady.mockResolvedValue({ ready: true });
      mockPi.Ads.showAd.mockResolvedValue({
        type: "rewarded",
        result: "AD_REWARDED",
      });

      expect(await sdk.showRewarded("extra-life")).toBe(false);
    });

    it("handles boolean isAdReady response for rewarded", async () => {
      const sdk = await SDKLite.init();
      setupAdSupported();

      mockPi.Ads.isAdReady.mockResolvedValue(true);
      mockPi.Ads.showAd.mockResolvedValue({
        type: "rewarded",
        result: "AD_REWARDED",
        adId: "ad-100",
      });
      mockGet.mockResolvedValueOnce({ data: { issued: true, granted: true } });

      expect(await sdk.showRewarded("extra-life")).toBe(true);
    });

    it("returns false when login fails", async () => {
      const sdk = await SDKLite.init();
      mockPi.authenticate.mockResolvedValue({ user: null, accessToken: null });

      expect(await sdk.showRewarded("extra-life")).toBe(false);
    });
  });

  // ── checkUserWatchedRewardedAd ──

  describe("checkUserWatchedRewardedAd", () => {
    it("retries up to the specified attempts", async () => {
      vi.useFakeTimers();
      const sdk = await SDKLite.init();
      stubSuccessfulLogin();
      await sdk.login();

      // First two calls: not granted yet. Third: granted.
      mockGet
        .mockResolvedValueOnce({ data: { issued: false, granted: false } })
        .mockResolvedValueOnce({ data: { issued: false, granted: false } })
        .mockResolvedValueOnce({ data: { issued: true, granted: true } });

      const promise = sdk.checkUserWatchedRewardedAd("ad-1", "extra-life", 3);

      // Advance through sleeps
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      expect(await promise).toBe(true);
      vi.useRealTimers();
    });

    it("returns false after exhausting attempts", async () => {
      vi.useFakeTimers();
      const sdk = await SDKLite.init();
      stubSuccessfulLogin();
      await sdk.login();

      mockGet.mockResolvedValue({ data: { issued: false, granted: false } });

      const promise = sdk.checkUserWatchedRewardedAd("ad-1", "extra-life", 2);

      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      expect(await promise).toBe(false);
      vi.useRealTimers();
    });

    it("returns false immediately on 404 from backend", async () => {
      const sdk = await SDKLite.init();
      stubSuccessfulLogin();
      await sdk.login();

      mockGet.mockRejectedValueOnce(axiosError(404));

      expect(await sdk.checkUserWatchedRewardedAd("ad-1", "extra-life", 3)).toBe(false);
    });

    it("returns false immediately on 403 from backend", async () => {
      const sdk = await SDKLite.init();
      stubSuccessfulLogin();
      await sdk.login();

      mockGet.mockRejectedValueOnce(axiosError(403));

      expect(await sdk.checkUserWatchedRewardedAd("ad-1", "extra-life", 3)).toBe(false);
    });
  });

  // ── onIncompletePaymentFound ──

  describe("onIncompletePaymentFound", () => {
    it("calls completePayment with the incomplete payment details", async () => {
      const sdk = await SDKLite.init();
      stubSuccessfulLogin();
      await sdk.login();

      mockPost.mockResolvedValueOnce({ status: 200 });

      sdk.onIncompletePaymentFound({
        identifier: "old-pay-1",
        transaction: { txid: "old-txid" },
        metadata: { productId: "prod-1" },
      });

      await new Promise((r) => setTimeout(r, 0));

      expect(mockPost).toHaveBeenCalledWith(
        "/proxy/v2/payments/old-pay-1/complete",
        { txid: "old-txid" },
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
  });
});
