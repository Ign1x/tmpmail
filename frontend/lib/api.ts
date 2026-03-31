import type {
  Account,
  Domain,
  DomainDnsRecord,
  Message,
  MessageDetail,
} from "@/types";
import {
  DEFAULT_DOMAIN,
  DEFAULT_PROVIDER_ID,
  PRESET_PROVIDERS,
  getDefaultDisabledProviderIds,
  getDefaultProviderConfig as getPresetDefaultProviderConfig,
} from "@/lib/provider-config";
import { normalizeEmailAddress } from "@/lib/account-validation";
import { readStoredJson } from "@/lib/storage";

interface FetchDomainsFromProviderOptions {
  apiKeyOverride?: string;
}

export interface AdminStatus {
  isPasswordConfigured: boolean;
  hasGeneratedApiKey: boolean;
  isRecoveryEnabled: boolean;
}

export interface AdminSessionResponse {
  sessionToken: string;
}

export interface AdminSetupResponse extends AdminSessionResponse {
  apiKey: string;
}

export interface AdminRecoveryRequest {
  recoveryToken: string;
  newPassword: string;
}

export interface AdminAccessKeyResponse {
  apiKey: string;
}

export interface AdminAuditLogsResponse {
  entries: string[];
}

export interface CleanupRunResponse {
  deletedAccounts: number;
  deletedMessages: number;
  deletedDomains: number;
}

export interface ServiceStatusResponse {
  status: "ready" | "degraded" | "offline";
  storeBackend?: string;
}

export interface AdminMetricsResponse {
  totalDomains: number;
  activeDomains: number;
  pendingDomains: number;
  totalAccounts: number;
  activeAccounts: number;
  totalMessages: number;
  activeMessages: number;
  deletedMessages: number;
  auditLogsTotal: number;
  inbucketSyncRunsTotal: number;
  inbucketSyncFailuresTotal: number;
  importedMessagesTotal: number;
  deletedUpstreamMessagesTotal: number;
  domainVerificationRunsTotal: number;
  domainVerificationFailuresTotal: number;
  cleanupRunsTotal: number;
  cleanupDeletedAccountsTotal: number;
  cleanupDeletedMessagesTotal: number;
  cleanupDeletedDomainsTotal: number;
  realtimeEventsTotal: number;
  sseConnectionsActive: number;
  lastInbucketSyncAt?: string;
  lastDomainVerificationAt?: string;
  lastCleanupAt?: string;
}

function getDefaultProviderConfig() {
  return getPresetDefaultProviderConfig();
}

function createBaseHeaders(providerId?: string): Record<string, string> {
  const provider = providerId
    ? getProviderConfig(providerId)
    : getDefaultProviderConfig();
  const headers: Record<string, string> = {};

  if (provider) {
    headers["X-API-Provider-ID"] = provider.id;

    if (provider.isCustom) {
      headers["X-API-Provider-Base-URL"] = provider.baseUrl;
    }
  }

  return headers;
}

export function createProviderHeaders(
  providerId?: string,
): Record<string, string> {
  return createBaseHeaders(providerId);
}

function attachBearerToken(
  headers: Record<string, string>,
  token?: string,
): HeadersInit {
  const trimmedToken = token?.trim();
  if (!trimmedToken) {
    return headers;
  }

  headers["Authorization"] = trimmedToken.startsWith("Bearer ")
    ? trimmedToken
    : `Bearer ${trimmedToken}`;

  return headers;
}

// 创建带有显式 Bearer 认证的请求头
function createHeadersWithApiKey(
  additionalHeaders: Record<string, string> = {},
  providerId?: string,
  apiKeyOverride?: string,
): HeadersInit {
  const headers = {
    ...createBaseHeaders(providerId),
    ...additionalHeaders,
  };

  return attachBearerToken(headers, apiKeyOverride);
}

function createHeadersWithBearer(
  bearerToken: string,
  additionalHeaders: Record<string, string> = {},
  providerId?: string,
): HeadersInit {
  const headers = {
    ...createBaseHeaders(providerId),
    ...additionalHeaders,
  };

  return attachBearerToken(headers, bearerToken);
}

// 创建带有 JWT Token 认证的请求头（用于其他所有需要认证的操作）
function createHeadersWithToken(
  token: string,
  additionalHeaders: Record<string, string> = {},
  providerId?: string,
): HeadersInit {
  const headers = {
    ...createBaseHeaders(providerId),
    ...additionalHeaders,
    Authorization: `Bearer ${token}`,
  };

  return headers;
}

function parseDownloadFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) {
    return null;
  }

  const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]).trim();
    } catch {
      return utf8Match[1].trim();
    }
  }

  const plainMatch = contentDisposition.match(/filename\s*=\s*"?([^"]+)"?/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim();
  }

  return null;
}

// 从邮箱地址推断提供商ID
function inferProviderFromEmail(email: string): string {
  if (typeof window === "undefined") return DEFAULT_PROVIDER_ID;

  try {
    const domain = normalizeEmailAddress(email).split("@")[1];
    if (!domain) return DEFAULT_PROVIDER_ID;

    const knownDomainPatterns: Record<string, string> = {};
    if (DEFAULT_DOMAIN) {
      knownDomainPatterns[DEFAULT_DOMAIN] = DEFAULT_PROVIDER_ID;
    }

    // 检查是否是已知域名
    if (knownDomainPatterns[domain]) {
      return knownDomainPatterns[domain];
    }

    // 获取所有域名信息（从localStorage缓存中获取，避免API调用）
    const domains = readStoredJson<unknown>("cached-domains", []);
    if (Array.isArray(domains)) {
      const matchedDomain = domains.find((d: any) => d.domain === domain);
      if (matchedDomain && matchedDomain.providerId) {
        return matchedDomain.providerId;
      }
    }

    // 如果没有找到匹配的域名，返回默认提供商
    return DEFAULT_PROVIDER_ID;
  } catch (error) {
    return DEFAULT_PROVIDER_ID;
  }
}

function getProviderConfig(providerId: string) {
  if (typeof window === "undefined") return null;

  try {
    let provider = PRESET_PROVIDERS.find(
      (presetProvider) => presetProvider.id === providerId,
    );

    if (!provider) {
      const parsed = readStoredJson<unknown>("custom-api-providers", []);
      if (Array.isArray(parsed)) {
        provider = parsed.find((p: any) => p.id === providerId);
      }
    }

    return provider || getDefaultProviderConfig();
  } catch (error) {
    return getDefaultProviderConfig();
  }
}

// 将后端端点路径转换为本地代理 URL（解决 CORS 问题，仅用于客户端）
function buildProxyUrl(endpoint: string): string {
  return `/api/mail?endpoint=${encodeURIComponent(endpoint)}`;
}

// 根据API文档改进错误处理
function getErrorMessage(status: number, errorData: any): string {
  // 前缀添加HTTP状态码，便于retryFetch识别
  const prefix = `HTTP ${status}: `;

  switch (status) {
    case 400:
      return prefix + "请求参数错误或缺失必要信息";
    case 401:
      return (
        prefix +
        (errorData?.detail || errorData?.message || "认证失败，请检查登录状态")
      );
    case 403:
      return (
        prefix +
        (errorData?.detail || errorData?.message || "当前操作被拒绝")
      );
    case 404:
      return prefix + "请求的资源不存在";
    case 405:
      return prefix + "请求方法不被允许";
    case 418:
      return prefix + "服务器暂时不可用";
    case 422:
      // 处理具体的422错误信息
      if (errorData?.violations && Array.isArray(errorData.violations)) {
        const violation = errorData.violations[0];
        if (
          violation?.propertyPath === "address" &&
          violation?.message?.includes("already used")
        ) {
          return prefix + "该邮箱地址已被使用，请尝试其他用户名";
        }
        return prefix + (violation?.message || "请求数据格式错误");
      }

      // 处理不同API提供商的错误消息格式
      const errorMessage = errorData?.detail || errorData?.message || "";

      // 统一处理邮箱已存在的错误
      if (
        errorMessage.includes("Email address already exists") ||
        errorMessage.includes("already used") ||
        errorMessage.includes("already exists")
      ) {
        return prefix + "该邮箱地址已被使用，请尝试其他用户名";
      }

      return (
        prefix +
        (errorMessage || "请求数据格式错误，请检查用户名长度或域名格式")
      );
    case 429:
      return prefix + "请求过于频繁，请稍后再试";
    default:
      return (
        prefix +
        (errorData?.message ||
          errorData?.details ||
          errorData?.error ||
          `请求失败`)
      );
  }
}

// 检查是否应该重试的错误
function shouldRetry(status: number): boolean {
  // 不应该重试的状态码（401由自动刷新机制处理）
  const noRetryStatuses = [400, 401, 403, 404, 405, 422, 429];
  return !noRetryStatuses.includes(status);
}

// 从localStorage获取当前账户信息
function getCurrentAccountFromStorage(): {
  address: string;
  password: string;
  token: string;
  providerId: string;
} | null {
  if (typeof window === "undefined") return null;

  try {
    const parsed = readStoredJson<any>("auth", null);
    if (!parsed || typeof parsed !== "object") return null;

    const currentAccount = parsed.currentAccount;
    if (!currentAccount || typeof currentAccount !== "object") return null;

    if (
      typeof currentAccount.address !== "string" ||
      typeof currentAccount.password !== "string" ||
      typeof (currentAccount.token || parsed.token) !== "string"
    ) {
      return null;
    }

    return {
      address: currentAccount.address,
      password: currentAccount.password,
      token: currentAccount.token || parsed.token,
      providerId: currentAccount.providerId || DEFAULT_PROVIDER_ID,
    };
  } catch (error) {
    return null;
  }
}

// 更新localStorage中的token，并通知auth-context同步更新
function updateTokenInStorage(newToken: string): void {
  if (typeof window === "undefined") return;

  try {
    const parsed = readStoredJson<any>("auth", null);
    if (!parsed || typeof parsed !== "object") return;

    if (parsed.currentAccount && typeof parsed.currentAccount === "object") {
      parsed.currentAccount.token = newToken;
      // 同时更新accounts数组中对应账户的token
      if (parsed.accounts && Array.isArray(parsed.accounts)) {
        parsed.accounts = parsed.accounts.map((acc: any) =>
          acc.address === parsed.currentAccount.address
            ? { ...acc, token: newToken }
            : acc,
        );
      }
    }
    parsed.token = newToken;

    localStorage.setItem("auth", JSON.stringify(parsed));

    // 触发自定义事件，通知auth-context更新React state
    window.dispatchEvent(
      new CustomEvent("token-refreshed", { detail: { token: newToken } }),
    );
  } catch {}
}

// 全局变量：用于防止并发token刷新
let refreshTokenPromise: Promise<string | null> | null = null;

// 尝试刷新token（在收到401时调用）- 带竞态保护
async function tryRefreshToken(): Promise<string | null> {
  // 如果已经有一个刷新请求在进行中，等待它完成
  if (refreshTokenPromise) {
    return refreshTokenPromise;
  }

  const account = getCurrentAccountFromStorage();
  if (!account || !account.password) {
    return null;
  }

  // 创建刷新Promise并存储，防止并发刷新
  refreshTokenPromise = (async () => {
    try {
      const headers = {
        ...createBaseHeaders(account.providerId),
        "Content-Type": "application/json",
      };

      const res = await fetch(buildProxyUrl("/token"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          address: account.address,
          password: account.password,
        }),
      });

      if (!res.ok) {
        return null;
      }

      const data = await res.json();
      const newToken = data.token;

      // 更新存储中的token
      updateTokenInStorage(newToken);

      return newToken;
    } catch (error) {
      console.error("Token refresh error:", error);
      return null;
    } finally {
      // 刷新完成后清除Promise，允许下次刷新
      refreshTokenPromise = null;
    }
  })();

  return refreshTokenPromise;
}

// 带自动token刷新的fetch函数
async function fetchWithTokenRefresh(
  url: string,
  options: RequestInit,
  providerId?: string,
  retried = false,
): Promise<Response> {
  const response = await fetch(url, options);

  // 如果收到401且还没重试过，尝试刷新token
  if (response.status === 401 && !retried) {
    const newToken = await tryRefreshToken();

    if (newToken) {
      // 用新token重试请求
      const newHeaders = {
        ...Object.fromEntries(
          new Headers(options.headers as HeadersInit).entries(),
        ),
        Authorization: `Bearer ${newToken}`,
      };

      return fetchWithTokenRefresh(
        url,
        { ...options, headers: newHeaders },
        providerId,
        true,
      );
    }
  }

  return response;
}

// 重试函数，改进错误处理
async function retryFetch(
  fn: () => Promise<any>,
  retries = 3,
  delay = 1000,
): Promise<any> {
  try {
    const response = await fn();
    return response;
  } catch (error: any) {
    // 如果错误包含状态码信息，检查是否应该重试
    if (error.message && typeof error.message === "string") {
      // 从错误消息中提取状态码
      const statusMatch = error.message.match(/HTTP (\d+)/);
      if (statusMatch) {
        const status = parseInt(statusMatch[1]);
        if (!shouldRetry(status)) {
          throw error;
        }
      }
    }

    // 对于其他错误，如果还有重试次数，则重试
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return retryFetch(fn, retries - 1, delay * 2);
    }
    throw error;
  }
}

async function requestDomainCollection(
  providerId: string,
  apiKeyOverride?: string,
): Promise<any[]> {
  const headers = createHeadersWithApiKey(
    { "Cache-Control": "no-cache" },
    providerId,
    apiKeyOverride,
  );

  const response = await retryFetch(async () => {
    const res = await fetch(buildProxyUrl("/domains"), { headers });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(getErrorMessage(res.status, error));
    }

    return res;
  });

  const data = await response.json();

  if (!data || !Array.isArray(data["hydra:member"])) {
    throw new Error("Invalid domains data format");
  }

  return data["hydra:member"];
}

// 获取单个提供商的域名
export async function fetchDomainsFromProvider(
  providerId: string,
  options: FetchDomainsFromProviderOptions = {},
): Promise<Domain[]> {
  try {
    const domainCollection = await requestDomainCollection(
      providerId,
      options.apiKeyOverride,
    );
    let availableDomains = domainCollection;

    if (providerId === DEFAULT_PROVIDER_ID) {
      availableDomains = domainCollection.filter((domain: any) => domain.isVerified);
    }

    return availableDomains.map((domain: any) => ({
      ...domain,
      providerId,
    }));
  } catch {
    return []; // 返回空数组而不是抛出错误，这样其他提供商仍然可以工作
  }
}

// 获取所有启用提供商的域名
export async function fetchAllDomains(): Promise<Domain[]> {
  if (typeof window === "undefined") return [];

  try {
    const disabledProvidersRaw = readStoredJson<unknown>(
      "disabled-api-providers",
      getDefaultDisabledProviderIds(),
    );
    const customProvidersRaw = readStoredJson<unknown>(
      "custom-api-providers",
      [],
    );
    const disabledProviders = Array.isArray(disabledProvidersRaw)
      ? disabledProvidersRaw
      : getDefaultDisabledProviderIds();
    const customProviders = Array.isArray(customProvidersRaw)
      ? customProvidersRaw
      : [];

    const allProviders = [...PRESET_PROVIDERS, ...customProviders];
    const enabledProviders = allProviders.filter(
      (p) => !disabledProviders.includes(p.id),
    );

    // 并行获取所有启用提供商的域名
    const domainPromises = enabledProviders.map((provider) =>
      fetchDomainsFromProvider(provider.id),
    );

    const domainResults = await Promise.all(domainPromises);

    // 合并所有域名，并添加提供商名称信息
    const allDomains: Domain[] = [];
    domainResults.forEach((domains, index) => {
      const provider = enabledProviders[index];
      domains.forEach((domain) => {
        allDomains.push({
          ...domain,
          providerId: provider.id,
          providerName: provider.name, // 添加提供商名称用于显示
        });
      });
    });

    return allDomains;
  } catch (error) {
    throw error;
  }
}

// 保持向后兼容的函数
export async function fetchDomains(): Promise<Domain[]> {
  return fetchAllDomains();
}

export async function fetchManagedDomains(
  providerId = DEFAULT_PROVIDER_ID,
  apiKeyOverride?: string,
): Promise<Domain[]> {
  const domains = await requestDomainCollection(providerId, apiKeyOverride);

  return domains.map((domain: any) => ({
    ...domain,
    providerId,
  }));
}

export async function getServiceStatus(
  providerId = DEFAULT_PROVIDER_ID,
): Promise<ServiceStatusResponse> {
  const headers = createBaseHeaders(providerId);
  const readyResponse = await fetch(buildProxyUrl("/readyz"), {
    headers,
    cache: "no-store",
  });

  if (readyResponse.ok) {
    const data = await readyResponse.json();
    return {
      status: "ready",
      storeBackend: data?.storeBackend,
    };
  }

  const healthResponse = await fetch(buildProxyUrl("/healthz"), {
    headers,
    cache: "no-store",
  });

  if (healthResponse.ok) {
    const data = await healthResponse.json();
    return {
      status: "degraded",
      storeBackend: data?.storeBackend,
    };
  }

  return { status: "offline" };
}

export async function getAdminStatus(
  providerId = DEFAULT_PROVIDER_ID,
): Promise<AdminStatus> {
  const headers = createBaseHeaders(providerId);
  const res = await fetch(buildProxyUrl("/admin/status"), {
    headers,
    cache: "no-store",
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(res.status, error));
  }

  return res.json();
}

export async function setupAdminPassword(
  password: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<AdminSetupResponse> {
  const headers = {
    ...createBaseHeaders(providerId),
    "Content-Type": "application/json",
  };
  const res = await fetch(buildProxyUrl("/admin/setup"), {
    method: "POST",
    headers,
    body: JSON.stringify({ password }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(res.status, error));
  }

  return res.json();
}

export async function loginAdmin(
  password: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<AdminSessionResponse> {
  const headers = {
    ...createBaseHeaders(providerId),
    "Content-Type": "application/json",
  };
  const res = await fetch(buildProxyUrl("/admin/login"), {
    method: "POST",
    headers,
    body: JSON.stringify({ password }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(res.status, error));
  }

  return res.json();
}

export async function validateAdminSession(
  sessionToken: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<boolean> {
  const headers = createHeadersWithBearer(sessionToken, {}, providerId);
  const res = await fetch(buildProxyUrl("/admin/session"), {
    headers,
    cache: "no-store",
  });

  if (res.ok) {
    return true;
  }

  if (res.status === 401 || res.status === 403) {
    return false;
  }

  const error = await res.json().catch(() => ({}));
  throw new Error(getErrorMessage(res.status, error));
}

export async function recoverAdmin(
  payload: AdminRecoveryRequest,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<AdminSetupResponse> {
  const headers = {
    ...createBaseHeaders(providerId),
    "Content-Type": "application/json",
  };
  const res = await fetch(buildProxyUrl("/admin/recover"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(res.status, error));
  }

  return res.json();
}

export async function getAdminAccessKey(
  sessionToken: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<AdminAccessKeyResponse> {
  const headers = createHeadersWithBearer(sessionToken, {}, providerId);
  const res = await fetch(buildProxyUrl("/admin/access-key"), {
    headers,
    cache: "no-store",
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(res.status, error));
  }

  return res.json();
}

export async function regenerateAdminAccessKey(
  sessionToken: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<AdminAccessKeyResponse> {
  const headers = createHeadersWithBearer(
    sessionToken,
    { "Content-Type": "application/json" },
    providerId,
  );
  const res = await fetch(buildProxyUrl("/admin/access-key/regenerate"), {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(res.status, error));
  }

  return res.json();
}

export async function updateAdminPassword(
  sessionToken: string,
  currentPassword: string,
  newPassword: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<void> {
  const headers = createHeadersWithBearer(
    sessionToken,
    { "Content-Type": "application/json" },
    providerId,
  );
  const res = await fetch(buildProxyUrl("/admin/password"), {
    method: "POST",
    headers,
    body: JSON.stringify({ currentPassword, newPassword }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(res.status, error));
  }
}

export async function getAdminMetrics(
  sessionToken: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<AdminMetricsResponse> {
  const headers = createHeadersWithBearer(sessionToken, {}, providerId);
  const res = await fetch(buildProxyUrl("/admin/metrics"), {
    headers,
    cache: "no-store",
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(res.status, error));
  }

  return res.json();
}

export async function getAdminAuditLogs(
  sessionToken: string,
  providerId = DEFAULT_PROVIDER_ID,
  limit = 50,
): Promise<AdminAuditLogsResponse> {
  const headers = createHeadersWithBearer(sessionToken, {}, providerId);
  const res = await fetch(
    buildProxyUrl(`/admin/audit-logs?limit=${encodeURIComponent(limit)}`),
    {
      headers,
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(res.status, error));
  }

  return res.json();
}

export async function runAdminCleanup(
  sessionToken: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<CleanupRunResponse> {
  const headers = createHeadersWithBearer(
    sessionToken,
    { "Content-Type": "application/json" },
    providerId,
  );
  const res = await fetch(buildProxyUrl("/admin/cleanup"), {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(res.status, error));
  }

  return res.json();
}

export async function createManagedDomain(
  domain: string,
  providerId = DEFAULT_PROVIDER_ID,
  apiKeyOverride?: string,
): Promise<Domain> {
  const headers = createHeadersWithApiKey(
    { "Content-Type": "application/json" },
    providerId,
    apiKeyOverride,
  );
  const res = await fetch(buildProxyUrl("/domains"), {
    method: "POST",
    headers,
    body: JSON.stringify({ domain }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(res.status, error));
  }

  const createdDomain = await res.json();
  return {
    ...createdDomain,
    providerId,
  };
}

export async function getManagedDomainRecords(
  domainId: string,
  providerId = DEFAULT_PROVIDER_ID,
  apiKeyOverride?: string,
): Promise<DomainDnsRecord[]> {
  const headers = createHeadersWithApiKey({}, providerId, apiKeyOverride);
  const res = await fetch(buildProxyUrl(`/domains/${domainId}/records`), {
    headers,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(res.status, error));
  }

  return res.json();
}

export async function verifyManagedDomain(
  domainId: string,
  providerId = DEFAULT_PROVIDER_ID,
  apiKeyOverride?: string,
): Promise<Domain> {
  const headers = createHeadersWithApiKey(
    { "Content-Type": "application/json" },
    providerId,
    apiKeyOverride,
  );
  const res = await fetch(buildProxyUrl(`/domains/${domainId}/verify`), {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(res.status, error));
  }

  const verifiedDomain = await res.json();
  return {
    ...verifiedDomain,
    providerId,
  };
}

// 创建账户
// expiresIn: 账户有效期（秒）。0 或 -1 = 永不过期，undefined = 服务端默认 24h，正数 = 自定义秒数
export async function createAccount(
  address: string,
  password: string,
  providerId?: string,
  expiresIn?: number,
): Promise<Account> {
  // 如果没有指定providerId，尝试从邮箱地址推断
  if (!providerId) {
    providerId = inferProviderFromEmail(address);
  }

  const headers = {
    ...createBaseHeaders(providerId),
    "Content-Type": "application/json",
  };

  // 构建请求体，仅在指定 expiresIn 时才传递该字段
  const requestBody: Record<string, any> = { address, password };
  if (expiresIn !== undefined) {
    requestBody.expiresIn = expiresIn;
  }

  const res = await fetch(buildProxyUrl("/accounts"), {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    const errorMessage = getErrorMessage(res.status, error);
    throw new Error(errorMessage);
  }

  return res.json();
}

// 登录获取 JWT Token（不需要 API Key）
export async function getToken(
  address: string,
  password: string,
  providerId?: string,
): Promise<{ token: string; id: string }> {
  // 如果没有指定providerId，尝试从邮箱地址推断
  if (!providerId) {
    providerId = inferProviderFromEmail(address);
  }

  const headers = {
    ...createBaseHeaders(providerId),
    "Content-Type": "application/json",
  };

  const res = await fetch(buildProxyUrl("/token"), {
    method: "POST",
    headers,
    body: JSON.stringify({ address, password }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(res.status, error));
  }

  return res.json();
}

// 获取账户信息（只需要 JWT Token）- 带自动token刷新
export async function getAccount(
  token: string,
  providerId?: string,
): Promise<Account> {
  let currentToken = token;

  const response = await retryFetch(async () => {
    const headers = createHeadersWithToken(currentToken, {}, providerId);
    const res = await fetchWithTokenRefresh(
      buildProxyUrl("/me"),
      { headers },
      providerId,
    );

    if (!res.ok) {
      if (res.status === 401) {
        const account = getCurrentAccountFromStorage();
        if (account && account.token && account.token !== currentToken) {
          currentToken = account.token;
          const retryHeaders = createHeadersWithToken(
            currentToken,
            {},
            providerId,
          );
          const retryRes = await fetch(buildProxyUrl("/me"), {
            headers: retryHeaders,
          });
          if (retryRes.ok) return retryRes;
        }
      }
      const error = await res.json().catch(() => ({}));
      throw new Error(getErrorMessage(res.status, error));
    }

    return res;
  });

  return response.json();
}

// 获取消息列表（只需要 JWT Token）- 带自动token刷新
export async function getMessages(
  token: string,
  page = 1,
  providerId?: string,
): Promise<{ messages: Message[]; total: number; hasMore: boolean }> {
  let currentToken = token;

  const response = await retryFetch(async () => {
    const headers = createHeadersWithToken(currentToken, {}, providerId);
    const res = await fetchWithTokenRefresh(
      buildProxyUrl(`/messages?page=${page}`),
      { headers },
      providerId,
    );

    if (!res.ok) {
      // 如果刷新后仍然失败，检查是否需要更新token
      if (res.status === 401) {
        // 尝试从storage获取最新token（可能已被刷新）
        const account = getCurrentAccountFromStorage();
        if (account && account.token && account.token !== currentToken) {
          currentToken = account.token;
          // 用新token重试一次
          const retryHeaders = createHeadersWithToken(
            currentToken,
            {},
            providerId,
          );
          const retryRes = await fetch(
            buildProxyUrl(`/messages?page=${page}`),
            { headers: retryHeaders },
          );
          if (retryRes.ok) return retryRes;
        }
      }
      const error = await res.json().catch(() => ({}));
      throw new Error(getErrorMessage(res.status, error));
    }

    return res;
  });

  const data = await response.json();
  const messages = data["hydra:member"] || [];
  const total = data["hydra:totalItems"] || 0;

  // 根据API文档，每页最多30条消息
  const hasMore = messages.length === 30 && page * 30 < total;

  return {
    messages,
    total,
    hasMore,
  };
}

// 获取单条消息详情（只需要 JWT Token）- 带自动token刷新
export async function getMessage(
  token: string,
  id: string,
  providerId?: string,
): Promise<MessageDetail> {
  let currentToken = token;

  const response = await retryFetch(async () => {
    const headers = createHeadersWithToken(currentToken, {}, providerId);
    const res = await fetchWithTokenRefresh(
      buildProxyUrl(`/messages/${id}`),
      { headers },
      providerId,
    );

    if (!res.ok) {
      if (res.status === 401) {
        const account = getCurrentAccountFromStorage();
        if (account && account.token && account.token !== currentToken) {
          currentToken = account.token;
          const retryHeaders = createHeadersWithToken(
            currentToken,
            {},
            providerId,
          );
          const retryRes = await fetch(buildProxyUrl(`/messages/${id}`), {
            headers: retryHeaders,
          });
          if (retryRes.ok) return retryRes;
        }
      }
      const error = await res.json().catch(() => ({}));
      throw new Error(getErrorMessage(res.status, error));
    }

    return res;
  });

  return response.json();
}

// 标记消息为已读（只需要 JWT Token）- 带自动token刷新
export async function markMessageAsRead(
  token: string,
  id: string,
  providerId?: string,
): Promise<{ seen: boolean }> {
  let currentToken = token;

  const response = await retryFetch(async () => {
    const headers = createHeadersWithToken(
      currentToken,
      { "Content-Type": "application/merge-patch+json" },
      providerId,
    );
    const res = await fetchWithTokenRefresh(
      buildProxyUrl(`/messages/${id}`),
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ seen: true }),
      },
      providerId,
    );

    if (!res.ok) {
      if (res.status === 401) {
        const account = getCurrentAccountFromStorage();
        if (account && account.token && account.token !== currentToken) {
          currentToken = account.token;
          const retryHeaders = createHeadersWithToken(
            currentToken,
            { "Content-Type": "application/merge-patch+json" },
            providerId,
          );
          const retryRes = await fetch(buildProxyUrl(`/messages/${id}`), {
            method: "PATCH",
            headers: retryHeaders,
            body: JSON.stringify({ seen: true }),
          });
          if (retryRes.ok) {
            if (
              retryRes.headers.get("content-type")?.includes("application/json")
            ) {
              return retryRes.json();
            }
            return { seen: true };
          }
        }
      }
      const error = await res.json().catch(() => ({}));
      throw new Error(getErrorMessage(res.status, error));
    }

    if (res.headers.get("content-type")?.includes("application/json")) {
      return res.json();
    }
    return { seen: true };
  });

  return response;
}

// 删除消息（只需要 JWT Token）- 带自动token刷新
export async function deleteMessage(
  token: string,
  id: string,
  providerId?: string,
): Promise<void> {
  let currentToken = token;

  await retryFetch(async () => {
    const headers = createHeadersWithToken(currentToken, {}, providerId);
    const res = await fetchWithTokenRefresh(
      buildProxyUrl(`/messages/${id}`),
      {
        method: "DELETE",
        headers,
      },
      providerId,
    );

    if (!res.ok) {
      if (res.status === 401) {
        const account = getCurrentAccountFromStorage();
        if (account && account.token && account.token !== currentToken) {
          currentToken = account.token;
          const retryHeaders = createHeadersWithToken(
            currentToken,
            {},
            providerId,
          );
          const retryRes = await fetch(buildProxyUrl(`/messages/${id}`), {
            method: "DELETE",
            headers: retryHeaders,
          });
          if (retryRes.ok) return retryRes;
        }
      }
      const error = await res.json().catch(() => ({}));
      throw new Error(getErrorMessage(res.status, error));
    }

    return res;
  });
}

// 删除账户（只需要 JWT Token）- 带自动token刷新
export async function deleteAccount(
  token: string,
  id: string,
  providerId?: string,
): Promise<void> {
  let currentToken = token;

  await retryFetch(async () => {
    const headers = createHeadersWithToken(currentToken, {}, providerId);
    const res = await fetchWithTokenRefresh(
      buildProxyUrl(`/accounts/${id}`),
      {
        method: "DELETE",
        headers,
      },
      providerId,
    );

    if (!res.ok) {
      if (res.status === 401) {
        const account = getCurrentAccountFromStorage();
        if (account && account.token && account.token !== currentToken) {
          currentToken = account.token;
          const retryHeaders = createHeadersWithToken(
            currentToken,
            {},
            providerId,
          );
          const retryRes = await fetch(buildProxyUrl(`/accounts/${id}`), {
            method: "DELETE",
            headers: retryHeaders,
          });
          if (retryRes.ok) return retryRes;
        }
      }
      const error = await res.json().catch(() => ({}));
      throw new Error(getErrorMessage(res.status, error));
    }

    return res;
  });
}

export async function downloadProtectedAsset(
  token: string,
  endpoint: string,
  providerId?: string,
  fallbackFilename?: string,
): Promise<void> {
  let currentToken = token;

  const response = await retryFetch(async () => {
    const headers = createHeadersWithToken(currentToken, {}, providerId);
    const res = await fetchWithTokenRefresh(
      buildProxyUrl(endpoint),
      { headers },
      providerId,
    );

    if (!res.ok) {
      if (res.status === 401) {
        const account = getCurrentAccountFromStorage();
        if (account && account.token && account.token !== currentToken) {
          currentToken = account.token;
          const retryHeaders = createHeadersWithToken(
            currentToken,
            {},
            providerId,
          );
          const retryRes = await fetch(buildProxyUrl(endpoint), {
            headers: retryHeaders,
          });
          if (retryRes.ok) return retryRes;
        }
      }

      const contentType = res.headers.get("content-type") || "";
      const errorPayload = contentType.includes("application/json")
        ? await res.json().catch(() => ({}))
        : { message: await res.text().catch(() => "") };
      throw new Error(getErrorMessage(res.status, errorPayload));
    }

    return res;
  });

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const filename =
    parseDownloadFilename(response.headers.get("content-disposition")) ||
    fallbackFilename ||
    "download.bin";

  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export async function downloadMessageSource(
  token: string,
  id: string,
  providerId?: string,
): Promise<void> {
  await downloadProtectedAsset(
    token,
    `/messages/${id}/raw`,
    providerId,
    `${id}.eml`,
  );
}

export async function downloadMessageAttachment(
  token: string,
  messageId: string,
  attachmentId: string,
  providerId?: string,
  fallbackFilename?: string,
): Promise<void> {
  await downloadProtectedAsset(
    token,
    `/messages/${messageId}/attachments/${attachmentId}`,
    providerId,
    fallbackFilename,
  );
}
