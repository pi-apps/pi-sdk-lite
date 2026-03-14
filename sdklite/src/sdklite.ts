import axios, { AxiosInstance } from "axios";

declare const __SDKLITE_BACKEND_URL__: string;

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_BACKEND_URL: string =
  typeof __SDKLITE_BACKEND_URL__ !== "undefined"
    ? __SDKLITE_BACKEND_URL__
    : "http://localhost:3005";

type ProductId = string;

type PurchaseErrorCode =
  | "product_not_found"
  | "purchase_cancelled"
  | "purchase_error";

interface PurchaseResult {
  ok: true;
  productId: ProductId;
  paymentId: string;
  txid: string;
}

class SDKLiteError extends Error {
  code: PurchaseErrorCode;

  constructor(code: PurchaseErrorCode, message: string) {
    super(message);
    this.name = "SDKLiteError";
    this.code = code;
  }
}

interface PiPaymentMetadata {
  productId?: ProductId;
  offerId?: string;
}

interface PiPaymentTransaction {
  txid: string;
}

interface PiPlatformPayment {
  identifier: string;
  transaction: PiPaymentTransaction;
  metadata?: PiPaymentMetadata;
}

interface PiPaymentData {
  amount: number;
  memo: string;
  metadata: PiPaymentMetadata;
}

interface Offer {
  offerId: string;
  amount: number;
  memo: string;
  exp?: string | null;
}

type UserStateBlob = Record<string, unknown>;

interface UserStateRecord {
  blob: UserStateBlob;
  updatedAt: string;
  version: number;
}

interface UserPurchaseBalance {
  productId: ProductId;
  quantity: number;
}

interface PurchasesResponse {
  purchases: UserPurchaseBalance[];
}

interface ConsumeResponse {
  productId: ProductId;
  quantity: number;
}

interface LegacyProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  price_in_pi: number;
  is_active: boolean;
  created_at: string;
}

interface LegacyProductsResponse {
  products: LegacyProduct[];
}

interface RestoreStateOptions {
  keys?: string[];
}

interface RewardedStatusResponse {
  issued?: boolean;
}

interface PiPaymentCallbacks {
  onReadyForServerApproval: (paymentId: string) => void;
  onReadyForServerCompletion: (paymentId: string, txid: string) => void;
  onCancel: () => void;
  onError: () => void;
}

const AD_TYPES = {
  INTERSTITIAL: "interstitial",
  REWARDED: "rewarded",
} as const;
type AdType = (typeof AD_TYPES)[keyof typeof AD_TYPES];

const AD_RESULTS = {
  REWARDED: "AD_REWARDED",
  CLOSED: "AD_CLOSED",
  DISPLAY_ERROR: "AD_DISPLAY_ERROR",
  NETWORK_ERROR: "AD_NETWORK_ERROR",
  NOT_AVAILABLE: "AD_NOT_AVAILABLE",
  NOT_SUPPORTED: "ADS_NOT_SUPPORTED",
  USER_UNAUTHENTICATED: "USER_UNAUTHENTICATED",
} as const;
type AdResult = (typeof AD_RESULTS)[keyof typeof AD_RESULTS];

const AD_REQUEST_RESULTS = {
  LOADED: "AD_LOADED",
} as const;

type InterstitialIsAdReadyResponse = boolean;

interface RewardedIsAdReadyResponse {
  ready: boolean;
}

type IsAdReadyResponse<T extends AdType> = T extends "interstitial"
  ? InterstitialIsAdReadyResponse
  : RewardedIsAdReadyResponse;

interface PiAdsShowAdResponse {
  type: AdType;
  result: AdResult;
  adId?: string;
}

interface PiAds {
  isAdReady<T extends AdType>(type: T): Promise<IsAdReadyResponse<T>>;
  requestAd(type: AdType): Promise<unknown>;
  showAd(type: AdType): Promise<PiAdsShowAdResponse>;
}

interface PiUser {
  uid?: string;
}

interface PiAuthenticateResult {
  user?: PiUser;
  accessToken?: string;
}

interface PiGlobal {
  authenticate: (
    scopes: string[],
    onIncompletePaymentFound: (payment: PiPlatformPayment) => void
  ) => Promise<PiAuthenticateResult>;
  nativeFeaturesList: () => Promise<string[]>;
  createPayment: (data: PiPaymentData, callbacks: PiPaymentCallbacks) => void;
  Ads: PiAds;
}

declare const Pi: PiGlobal;

declare global {
  interface Window {
    __ENV?: {
      backend_url?: string;
    };
    SDKLite?: unknown;
  }
}

function createBackendClient(): AxiosInstance {
  return axios.create({
    baseURL: window.__ENV?.backend_url ?? DEFAULT_BACKEND_URL,
    timeout: DEFAULT_TIMEOUT_MS,
  });
}

class SDKLiteInstance {
  private readonly backendAPIClient: AxiosInstance;

  readonly state: {
    get: (key: string) => Promise<UserStateRecord | null>;
    set: (key: string, blob: UserStateBlob) => Promise<void>;
    restore: (options?: RestoreStateOptions) => Promise<PurchasesResponse>;
    purchases: () => Promise<PurchasesResponse>;
    products: (appId: string) => Promise<LegacyProductsResponse>;
    consume: (productId: ProductId, quantity?: number) => Promise<ConsumeResponse>;
  };

  private userLoggedIn: boolean;

  private adNetworkSupported: boolean;

  private piAccessToken: string | null;

  constructor() {
    this.backendAPIClient = createBackendClient();

    this.userLoggedIn = false;
    this.adNetworkSupported = false;
    this.piAccessToken = null;

    this.state = {
      get: this.getUserState.bind(this),
      set: this.setUserState.bind(this),
      restore: this.restoreState.bind(this),
      purchases: this.getPurchases.bind(this),
      products: this.getLegacyProducts.bind(this),
      consume: this.consumePurchase.bind(this),
    };

    this.onIncompletePaymentFound = this.onIncompletePaymentFound.bind(this);
  }

  private authHeaders(): { Authorization: string } | {} {
    if (!this.piAccessToken) return {};
    return { Authorization: `Bearer ${this.piAccessToken}` };
  }

  async init(): Promise<SDKLiteInstance> {
    return this;
  }

  async login(): Promise<boolean> {
    if (this.userLoggedIn) return true;

    if (!this.piAccessToken) {
      const scopes = ["username", "payments"];
      const { user, accessToken } = await Pi.authenticate(scopes, this.onIncompletePaymentFound);
      if (!user?.uid || !accessToken) return false;
      this.piAccessToken = accessToken;
    }

    try {
      await this.backendAPIClient.post("/v1/login", {
        pi_auth_token: this.piAccessToken
      });
      this.userLoggedIn = true;
      return true;
    } catch {
      return false;
    }
  }

  private async createOffer(productId: ProductId): Promise<Offer> {
    try {
      const response = await this.backendAPIClient.post<Offer>(
        "/v1/offers",
        { productId },
        { headers: this.authHeaders() }
      );
      if (response.status !== 201) {
        throw new SDKLiteError("purchase_error", "Failed to prepare purchase.");
      }

      const offer = response.data;
      if (!offer?.offerId || typeof offer.amount !== "number" || !offer.memo) {
        throw new SDKLiteError("purchase_error", "Invalid purchase setup response.");
      }

      return offer;
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new SDKLiteError("product_not_found", "Product not found.");
      }

      if (error instanceof SDKLiteError) throw error;
      throw new SDKLiteError("purchase_error", "Failed to prepare purchase.");
    }
  }

  async isAdNetworkSupported(): Promise<boolean> {
    if (this.adNetworkSupported) return true;

    const nativeFeaturesList = await Pi.nativeFeaturesList();
    this.adNetworkSupported = nativeFeaturesList.includes("ad_network");
    return this.adNetworkSupported;
  }

  async makePurchase(productId: ProductId): Promise<PurchaseResult> {
    const loggedIn = await this.login();
    if (!loggedIn) {
      throw new SDKLiteError("purchase_error", "Unable to authenticate user for purchase.");
    }

    const offer = await this.createOffer(productId);

    const paymentData: PiPaymentData = {
      amount: offer.amount,
      memo: offer.memo,
      metadata: { productId, offerId: offer.offerId },
    };

    return this.conductPayment(productId, paymentData);
  }

  private async getUserState(key: string): Promise<UserStateRecord | null> {
    const loggedIn = await this.login();
    if (!loggedIn) {
      throw new Error("Unable to authenticate user for state access.");
    }

    try {
      const response = await this.backendAPIClient.get<UserStateRecord>(
        `/v1/user-state/${encodeURIComponent(key)}`,
        { headers: this.authHeaders() }
      );
      return response.data;
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  private async setUserState(key: string, blob: UserStateBlob): Promise<void> {
    const loggedIn = await this.login();
    if (!loggedIn) {
      throw new Error("Unable to authenticate user for state access.");
    }

    const response = await this.backendAPIClient.put(
      `/v1/user-state/${encodeURIComponent(key)}`,
      { blob },
      { headers: this.authHeaders() }
    );

    // TODO: Decide if we should throw or do something less loud in the interface
    if (response.status !== 204) {
      throw new Error("Failed to persist user state.");
    }
  }

  private async getPurchases(): Promise<PurchasesResponse> {
    const loggedIn = await this.login();
    if (!loggedIn) {
      throw new Error("Unable to authenticate user for purchases access.");
    }

    const response = await this.backendAPIClient.get<PurchasesResponse>(
      "/v1/purchases",
      { headers: this.authHeaders() }
    );
    return response.data;
  }

  private async restoreState(_options?: RestoreStateOptions): Promise<PurchasesResponse> {
    // Minimal first iteration: mirror purchases() shape.
    // TODO: Fetch the rest of the state (user states and app config)
    return this.getPurchases();
  }

  private async consumePurchase(
    productId: ProductId,
    quantity?: number
  ): Promise<ConsumeResponse> {
    const loggedIn = await this.login();
    if (!loggedIn) {
      throw new Error("Unable to authenticate user for purchases access.");
    }

    const payload =
      typeof quantity === "number" ? { productId, quantity } : { productId };
    const response = await this.backendAPIClient.post<ConsumeResponse>(
      "/v1/purchases/consume",
      payload,
      { headers: this.authHeaders() }
    );
    return response.data;
  }

  private conductPayment(productId: ProductId, paymentData: PiPaymentData): Promise<PurchaseResult> {
    return new Promise<PurchaseResult>((resolve, reject) => {
      let settled = false; // Ensure we only resolve/reject once across all callbacks
      const settleSuccess = (result: PurchaseResult): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const settleError = (code: PurchaseErrorCode, message: string): void => {
        if (settled) return;
        settled = true;
        reject(new SDKLiteError(code, message));
      };

      const callbacks: PiPaymentCallbacks = {
        onReadyForServerApproval: (paymentId) => {
          void this.backendAPIClient
            .post(`/proxy/v2/payments/${paymentId}/approve`, null, { headers: this.authHeaders() })
            .catch(() => {
              settleError("purchase_error", "Failed to approve payment on backend.");
            });
        },
        onReadyForServerCompletion: (paymentId, txid) => {
          void this.completePayment(paymentId, txid)
            .then((ok) => {
              if (!ok) {
                settleError("purchase_error", "Failed to complete payment on backend.");
                return;
              }

              settleSuccess({
                ok: true,
                productId,
                paymentId,
                txid,
              });
            })
            .catch(() => {
              settleError("purchase_error", "Failed to complete payment on backend.");
            });
        },
        onCancel: () => settleError("purchase_cancelled", "Payment was cancelled by user."),
        onError: () => settleError("purchase_error", "Payment failed in Pi SDK."),
      };

      try {
        Pi.createPayment(paymentData, callbacks);
      } catch {
        settleError("purchase_error", "Unable to start payment.");
      }
    });
  }

  async completePayment(
    paymentId: string,
    txidFromUser: string
  ): Promise<boolean> {
    const completeResp = await this.backendAPIClient.post(
      `/proxy/v2/payments/${paymentId}/complete`,
      { txid: txidFromUser },
      { headers: this.authHeaders() }
    );

    return completeResp.status === 200;
  }

  async showInterstitial(): Promise<boolean> {
    try {
      const loggedIn = await this.login();
      if (!loggedIn) return false;
      const supported = await this.isAdNetworkSupported();
      if (!supported) return false;

      const ready = await Pi.Ads.isAdReady(AD_TYPES.INTERSTITIAL);
      if (ready === false) {
        await Pi.Ads.requestAd(AD_TYPES.INTERSTITIAL);
      }

      const showAdResponse = await Pi.Ads.showAd(AD_TYPES.INTERSTITIAL);
      return showAdResponse.result === AD_RESULTS.CLOSED;
    } catch {
      return false;
    }
  }

  async showRewarded(productId: ProductId): Promise<boolean> {
    try {
      const loggedIn = await this.login();
      if (!loggedIn) return false;
      const supported = await this.isAdNetworkSupported();
      if (!supported) return false;

      const isRewardedReadyResponse = await Pi.Ads.isAdReady(AD_TYPES.REWARDED);
      const ready =
        typeof isRewardedReadyResponse === "boolean"
          ? isRewardedReadyResponse
          : isRewardedReadyResponse.ready;

      if (ready === false) {
        const requestAdResponse = await Pi.Ads.requestAd(AD_TYPES.REWARDED);

        if (requestAdResponse !== AD_REQUEST_RESULTS.LOADED) return false;
      }

      const showAdResponse = await Pi.Ads.showAd(AD_TYPES.REWARDED);
      if (showAdResponse.result !== AD_RESULTS.REWARDED || !showAdResponse.adId) {
        return false;
      }

      return this.checkUserWatchedRewardedAd(showAdResponse.adId, productId);
    } catch {
      return false;
    }
  }

  async checkUserWatchedRewardedAd(
    adId: string,
    productId: ProductId,
    attemptsLeft = 3
  ): Promise<boolean> {
    const sleep = (seconds: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, seconds * 1000);
      });

    if (attemptsLeft === 0) return false;

    try {
      const adNetworkStatusResponse = await this.backendAPIClient.get<RewardedStatusResponse>(
        `/v1/ads/status/${adId}`,
        {
          headers: this.authHeaders(),
          params: { productId },
        }
      );

      if (adNetworkStatusResponse.data?.issued === true) {
        return true;
      }
    } catch (err: unknown) {
      if (
        axios.isAxiosError(err) &&
        (err.response?.status === 404 || err.response?.status === 403)
      ) {
        return false;
      }
    }

    await sleep(1);
    return this.checkUserWatchedRewardedAd(adId, productId, attemptsLeft - 1);
  }

  /**
   * @deprecated Temporary legacy method for apps migrating from non-SDKLite payment flows.
   * Calls GET /v1/apps/:app_id/products to retrieve the product catalog.
   */
  async getLegacyProducts(appId: string): Promise<LegacyProductsResponse> {
    const loggedIn = await this.login();
    if (!loggedIn) {
      throw new Error("Unable to authenticate user for products access.");
    }

    const response = await this.backendAPIClient.get<LegacyProductsResponse>(
      `/v1/apps/${encodeURIComponent(appId)}/products`,
      { headers: this.authHeaders() }
    );
    return response.data;
  }

  onIncompletePaymentFound(payment: PiPlatformPayment): void {
    // TODO: Check whether we need to explicitly fetch purchases state after this
    void this.completePayment(payment.identifier, payment.transaction.txid).catch(() => false);
  }
}

const PiSDKLite = {
  async init(): Promise<SDKLiteInstance> {
    // TODO: Maybe init Pi SDK instance ourselves?
    const instance = new SDKLiteInstance();
    return instance.init();
  },
};

if (typeof window !== "undefined") {
  window.SDKLite = PiSDKLite;
}


