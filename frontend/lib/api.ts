import type {
  Account,
  AuthState,
  Domain,
  DomainDnsRecord,
  Message,
  MessageDetail,
} from "@/types";
import {
  DEFAULT_PROVIDER_ID,
} from "@/lib/provider-config";
import { clearStoredAdminSession } from "@/lib/admin-session";
import { ADMIN_SESSION_PROXY_HEADER } from "@/lib/admin-session-cookie";
import { normalizeEmailAddress } from "@/lib/account-validation";
import { removeStoredValue } from "@/lib/storage";

const CLIENT_FETCH_TIMEOUT_MS = 15_000;
const ADMIN_SESSION_READY_ATTEMPTS = 12;
const ADMIN_SESSION_READY_DELAY_MS = 250;
const ADMIN_SESSION_RESTORE_ATTEMPTS = 2;
const ADMIN_SESSION_RESTORE_DELAY_MS = 150;
const ADMIN_SESSION_REQUEST_TIMEOUT_MS = 4_000;
const SERVICE_STATUS_REQUEST_TIMEOUT_MS = 4_000;
const nativeFetch = globalThis.fetch.bind(globalThis);
const LEGACY_MAILBOX_AUTH_STORAGE_KEY = "auth";
export const MAILBOX_TOKEN_REFRESHED_EVENT = "token-refreshed";

interface FetchDomainsFromProviderOptions {
  apiKeyOverride?: string;
}

function normalizeManagedDomainResponse(
  domain: Domain,
  providerId = DEFAULT_PROVIDER_ID,
): Domain {
  return {
    ...domain,
    ownerUserId: domain.ownerUserId ?? undefined,
    verificationToken: domain.verificationToken ?? undefined,
    verificationError: domain.verificationError ?? undefined,
    providerId,
  }
}

export interface AdminStatus {
  isBootstrapRequired: boolean;
  usersTotal: number;
  adminUsersTotal: number;
  isRecoveryEnabled: boolean;
  systemEnabled: boolean;
  openRegistrationEnabled: boolean;
  linuxDoEnabled: boolean;
  emailOtpEnabled: boolean;
}

export type ConsoleUserRole = "admin" | "user"

export interface ConsoleUser {
  id: string
  username: string
  role: ConsoleUserRole
  domainLimit: number
  isDisabled: boolean
  apiKeyHint?: string
  createdAt: string
  updatedAt: string
}

export interface AdminSystemSettings {
  systemEnabled: boolean
  mailExchangeHost?: string
  mailRouteTarget?: string
  domainTxtPrefix?: string
  smtp: AdminSmtpSettings
  registrationSettings: AdminRegistrationSettings
  userLimits: AdminUserLimitsSettings
}

export interface AdminUserLimitsSettings {
  defaultDomainLimit: number
  mailboxLimit: number
  apiKeyLimit: number
}

export interface AdminEmailOtpSettings {
  enabled: boolean
  subject?: string
  body?: string
  ttlSeconds: number
  cooldownSeconds: number
}

export interface AdminSmtpSettings {
  host?: string
  port: number
  username?: string
  password?: string
  passwordConfigured: boolean
  fromAddress?: string
  fromName?: string
  security: "plain" | "starttls" | "tls"
}

export interface LinuxDoAuthSettings {
  enabled: boolean
  clientId?: string
  clientSecret?: string
  clientSecretConfigured: boolean
  minimumTrustLevel: number
  authorizeUrl?: string
  tokenUrl?: string
  userinfoUrl?: string
  callbackUrl?: string
}

export interface AdminRegistrationSettings {
  openRegistrationEnabled: boolean
  allowedEmailSuffixes: string[]
  emailOtp: AdminEmailOtpSettings
  linuxDo: LinuxDoAuthSettings
}

export interface AdminSessionInfo {
  user: ConsoleUser
  systemSettings: AdminSystemSettings
}

export interface AdminSessionResponse {
  sessionToken?: string;
  session: AdminSessionInfo;
}

export interface AdminSetupResponse extends AdminSessionResponse {
  apiKey: string;
}

export interface AdminBootstrapRequest {
  username: string
  password: string
}

export interface AdminLoginRequest {
  username: string
  password: string
}

export interface ConsoleRegisterRequest {
  username?: string
  email?: string
  password: string
  otpCode?: string
}

export interface SendEmailOtpRequest {
  email: string
}

export interface SendEmailOtpResponse {
  expiresInSeconds: number
  cooldownSeconds: number
}

export interface AdminRecoveryRequest {
  recoveryToken: string;
  username?: string;
  newPassword: string;
}

export interface AdminCreateUserRequest {
  username: string
  password: string
  role: ConsoleUserRole
  domainLimit: number
}

export interface AdminUpdateUserRequest {
  username?: string
  role?: ConsoleUserRole
  domainLimit?: number
  isDisabled?: boolean
}

export interface AdminResetUserPasswordRequest {
  newPassword: string
}

export interface AdminUpdateSystemSettingsRequest {
  systemEnabled?: boolean
  mailExchangeHost?: string
  mailRouteTarget?: string
  domainTxtPrefix?: string
  smtp?: AdminSmtpSettings
  registrationSettings?: AdminRegistrationSettings
  userLimits?: AdminUserLimitsSettings
}

export interface AdminAccessKey {
  id: string
  name: string
  maskedKey: string
  createdAt: string
}

export interface AdminAccessKeyListResponse {
  keys: AdminAccessKey[]
  limit: number
}

export interface AdminAccessKeyInfoResponse {
  key: AdminAccessKey
}

export interface AdminAccessKeyResponse {
  key: AdminAccessKey
  apiKey: string;
}

export interface ConsoleCloudflareSettings {
  enabled: boolean
  apiTokenConfigured: boolean
  autoSyncEnabled: boolean
}

export interface UpdateConsoleCloudflareSettingsRequest {
  enabled: boolean
  apiToken?: string
  autoSyncEnabled: boolean
}

export interface CloudflareDnsSyncResponse {
  zoneName: string
  createdRecords: number
  updatedRecords: number
  unchangedRecords: number
  domain?: Domain
}

export interface CloudflareTokenValidationResponse {
  zoneCount: number
  zones: string[]
}

export interface AdminCreateAccessKeyRequest {
  name?: string
}

export interface LinuxDoAuthorizeResponse {
  authorizationUrl: string
}

export interface LinuxDoCompleteRequest {
  code: string
  redirectUri: string
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

export type PublicNoticeTone = "info" | "warning" | "success"

export interface PublicUpdateNoticeSection {
  tone: PublicNoticeTone
  title: string
  body?: string
  bullets?: string[]
}

export interface LocalizedUpdateNoticeContent {
  title: string
  dateLabel: string
  dismissLabel: string
  sections: PublicUpdateNoticeSection[]
  footer?: string
}

export interface PublicUpdateNotice {
  enabled: boolean
  autoOpen: boolean
  version: string
  zh: LocalizedUpdateNoticeContent
  en: LocalizedUpdateNoticeContent
}

type HydraCollection<T> = {
  "hydra:member"?: T[]
}

export interface AdminRuntimeMetrics {
  cpuUsagePercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  memoryUsagePercent: number;
  uptimeSeconds: number;
}

export interface AdminMetricsResponse {
  consoleUsersTotal: number;
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
  runtime: AdminRuntimeMetrics;
}

type ApiViolation = {
  propertyPath?: string;
  message?: string;
};

type ApiErrorPayload = {
  detail?: string;
  message?: string;
  details?: string;
  error?: string;
  violations?: ApiViolation[];
  token?: string;
};

type RuntimeMailboxAuthAccount = {
  id?: string;
  address: string;
  password?: string;
  token?: string;
  providerId?: string;
};

type RuntimeMailboxAuthState = {
  token: string | null;
  currentAccount: RuntimeMailboxAuthAccount | null;
  accounts: RuntimeMailboxAuthAccount[];
};

let runtimeMailboxAuthState: RuntimeMailboxAuthState = {
  token: null,
  currentAccount: null,
  accounts: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeRuntimeMailboxAuthAccount(
  value: Account | RuntimeMailboxAuthAccount | null | undefined,
): RuntimeMailboxAuthAccount | null {
  if (!value || typeof value.address !== "string") {
    return null;
  }

  return {
    id: typeof value.id === "string" ? value.id : undefined,
    address: value.address.trim(),
    password:
      typeof value.password === "string" && value.password.trim()
        ? value.password
        : undefined,
    token:
      typeof value.token === "string" && value.token.trim()
        ? value.token
        : undefined,
    providerId:
      typeof value.providerId === "string" && value.providerId.trim()
        ? value.providerId
        : DEFAULT_PROVIDER_ID,
  };
}

export function clearLegacyStoredMailboxAuth(): void {
  removeStoredValue(LEGACY_MAILBOX_AUTH_STORAGE_KEY);
}

export function syncRuntimeMailboxAuthState(authState: AuthState): void {
  runtimeMailboxAuthState = {
    token: authState.token?.trim() || null,
    currentAccount: normalizeRuntimeMailboxAuthAccount(authState.currentAccount),
    accounts: authState.accounts
      .map((account) => normalizeRuntimeMailboxAuthAccount(account))
      .filter((account): account is RuntimeMailboxAuthAccount => !!account),
  };
}

function getApiErrorPayload(value: unknown): ApiErrorPayload {
  return isRecord(value) ? (value as ApiErrorPayload) : {};
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), CLIENT_FETCH_TIMEOUT_MS);
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort();

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
    }
  }

  try {
    return await nativeFetch(input, {
      ...init,
      credentials: init.credentials ?? "same-origin",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError" && !upstreamSignal?.aborted) {
      throw new Error("HTTP 504: 请求超时，请稍后重试");
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

const fetch = fetchWithTimeout;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

function createBaseHeaders(providerId?: string): Record<string, string> {
  return {
    "X-API-Provider-ID": providerId?.trim() || DEFAULT_PROVIDER_ID,
  };
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

function createHeadersWithAdminSession(
  additionalHeaders: Record<string, string> = {},
  providerId?: string,
): HeadersInit {
  return {
    ...createBaseHeaders(providerId),
    ...additionalHeaders,
    [ADMIN_SESSION_PROXY_HEADER]: "1",
  };
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
  void email;
  normalizeEmailAddress(email);
  return DEFAULT_PROVIDER_ID;
}

// 将后端端点路径转换为本地代理 URL（解决 CORS 问题，仅用于客户端）
function buildProxyUrl(endpoint: string): string {
  return `/api/mail?endpoint=${encodeURIComponent(endpoint)}`;
}

// 根据API文档改进错误处理
function getErrorMessage(status: number, errorData: unknown): string {
  const payload = getApiErrorPayload(errorData);
  // 前缀添加HTTP状态码，便于retryFetch识别
  const prefix = `HTTP ${status}: `;

  switch (status) {
    case 400:
      return prefix + "请求参数错误或缺失必要信息";
    case 401:
      return (
        prefix +
        (payload.detail || payload.message || "认证失败，请检查登录状态")
      );
    case 403:
      return (
        prefix +
        (payload.detail || payload.message || "当前操作被拒绝")
      );
    case 404:
      return prefix + "请求的资源不存在";
    case 405:
      return prefix + "请求方法不被允许";
    case 418:
      return prefix + "服务器暂时不可用";
    case 422:
      // 处理具体的422错误信息
      if (payload.violations && Array.isArray(payload.violations)) {
        const violation = payload.violations[0];
        if (
          violation?.propertyPath === "address" &&
          violation?.message?.includes("already used")
        ) {
          return prefix + "该邮箱地址已被使用，请尝试其他用户名";
        }
        return prefix + (violation?.message || "请求数据格式错误");
      }

      // 处理不同API提供商的错误消息格式
      const errorMessage = payload.detail || payload.message || "";

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
        (payload.message ||
          payload.details ||
          payload.error ||
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

// 从运行时状态获取当前账户信息，避免把凭据写进浏览器持久化存储。
function getCurrentAccountFromRuntime(): {
  id?: string;
  address: string;
  password?: string;
  token: string;
  providerId: string;
} | null {
  const currentAccount = runtimeMailboxAuthState.currentAccount;
  const effectiveToken = currentAccount?.token || runtimeMailboxAuthState.token;
  if (!currentAccount || typeof effectiveToken !== "string" || !effectiveToken.trim()) {
    return null;
  }

  return {
    id: currentAccount.id,
    address: currentAccount.address,
    password: currentAccount.password,
    token: effectiveToken,
    providerId: currentAccount.providerId || DEFAULT_PROVIDER_ID,
  };
}

// 更新运行时 token，并通知 auth-context 同步 React state。
function updateRuntimeMailboxToken(newToken: string): void {
  const trimmedToken = newToken.trim();
  if (!trimmedToken) {
    return;
  }

  const currentAccount = runtimeMailboxAuthState.currentAccount;
  if (!currentAccount) {
    runtimeMailboxAuthState = {
      ...runtimeMailboxAuthState,
      token: trimmedToken,
    };
    return;
  }

  const updatedCurrentAccount = {
    ...currentAccount,
    token: trimmedToken,
  };
  const updatedAccounts = runtimeMailboxAuthState.accounts.map((account) =>
    (updatedCurrentAccount.id && account.id === updatedCurrentAccount.id) ||
    account.address === updatedCurrentAccount.address
      ? { ...account, token: trimmedToken }
      : account,
  );

  runtimeMailboxAuthState = {
    token: trimmedToken,
    currentAccount: updatedCurrentAccount,
    accounts: updatedAccounts,
  };

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(MAILBOX_TOKEN_REFRESHED_EVENT, {
        detail: { token: trimmedToken },
      }),
    );
  }
}

async function ensureAdminSessionResponse(response: Response): Promise<Response> {
  if (response.ok) {
    return response;
  }

  if (response.status === 401 || response.status === 403) {
    clearStoredAdminSession();
  }

  const error = await response.json().catch(() => ({}));
  throw new Error(getErrorMessage(response.status, error));
}

async function readJsonWithTimeout<T>(
  response: Response,
  timeoutMs = CLIENT_FETCH_TIMEOUT_MS,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error("HTTP 504: 响应超时，请稍后重试"));
    }, timeoutMs);

    response
      .json()
      .then((payload) => resolve(payload as T))
      .catch(reject)
      .finally(() => globalThis.clearTimeout(timeoutId));
  });
}

async function requestAdminSessionResponse(
  providerId = DEFAULT_PROVIDER_ID,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), ADMIN_SESSION_REQUEST_TIMEOUT_MS)
  const headers = createHeadersWithAdminSession({}, providerId)
  try {
    return await fetch(buildProxyUrl("/admin/session"), {
      headers,
      cache: "no-store",
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("HTTP 504: 请求超时，请稍后重试")
    }

    throw error
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

function isRetryableAdminSessionError(status: number): boolean {
  return [401, 403, 502, 503, 504].includes(status)
}

function isRetryableAdminSessionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  if (error.name === "AbortError") {
    return true
  }

  return /\bHTTP (502|503|504)\b/.test(error.message)
}

export async function waitForAdminSessionInfo(
  providerId = DEFAULT_PROVIDER_ID,
  options?: {
    attempts?: number
    delayMs?: number
  },
): Promise<AdminSessionInfo> {
  const attempts = Math.max(1, options?.attempts ?? ADMIN_SESSION_READY_ATTEMPTS)
  const delayMs = Math.max(0, options?.delayMs ?? ADMIN_SESSION_READY_DELAY_MS)
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await requestAdminSessionResponse(providerId)

      if (response.ok) {
        return response.json()
      }

      const error = await response.json().catch(() => ({}))
      lastError = new Error(getErrorMessage(response.status, error))

      if (!isRetryableAdminSessionError(response.status) || attempt === attempts) {
        if (response.status === 401 || response.status === 403) {
          clearStoredAdminSession()
        }
        throw lastError
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("HTTP 503: 管理会话暂时不可用")

      if (!isRetryableAdminSessionFailure(lastError) || attempt === attempts) {
        throw lastError
      }
    }

    await sleep(delayMs)
  }

  throw lastError ?? new Error("HTTP 503: 管理会话暂时不可用")
}

export async function restoreAdminSessionInfo(
  providerId = DEFAULT_PROVIDER_ID,
  options?: {
    attempts?: number
    delayMs?: number
  },
): Promise<AdminSessionInfo> {
  const attempts = Math.max(1, options?.attempts ?? ADMIN_SESSION_RESTORE_ATTEMPTS)
  const delayMs = Math.max(0, options?.delayMs ?? ADMIN_SESSION_RESTORE_DELAY_MS)
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await getAdminSessionInfo(providerId)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("HTTP 503: 管理会话暂时不可用")

      if (!isRetryableAdminSessionFailure(lastError) || attempt === attempts) {
        throw lastError
      }
    }

    await sleep(delayMs)
  }

  throw lastError ?? new Error("HTTP 503: 管理会话暂时不可用")
}

// 全局变量：用于防止并发token刷新
let refreshTokenPromise: Promise<string | null> | null = null;

// 尝试刷新token（在收到401时调用）- 带竞态保护
async function tryRefreshToken(): Promise<string | null> {
  // 如果已经有一个刷新请求在进行中，等待它完成
  if (refreshTokenPromise) {
    return refreshTokenPromise;
  }

  const account = getCurrentAccountFromRuntime();
  if (!account) {
    return null;
  }

  // 创建刷新Promise并存储，防止并发刷新
  refreshTokenPromise = (async () => {
    try {
      const res =
        account.id
          ? await fetch(buildProxyUrl(`/accounts/${account.id}/token`), {
              method: "POST",
              headers: createHeadersWithAdminSession(
                { "Content-Type": "application/json" },
                account.providerId,
              ),
              body: JSON.stringify({}),
            })
          : account.password
            ? await fetch(buildProxyUrl("/token"), {
                method: "POST",
                headers: {
                  ...createBaseHeaders(account.providerId),
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  address: account.address,
                  password: account.password,
                }),
              })
            : null;

      if (!res || !res.ok) {
        return null;
      }

      const data = await res.json();
      const newToken = data.token;

      // 更新运行时 token，避免把敏感凭据写入浏览器持久化存储。
      updateRuntimeMailboxToken(newToken);

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
type RetryFetchOptions = {
  retries?: number;
  delayMs?: number;
}

async function retryFetch<T>(
  fn: () => Promise<T>,
  options: RetryFetchOptions = {},
): Promise<T> {
  const retries = options.retries ?? 3;
  const delayMs = options.delayMs ?? 1000;

  try {
    const response = await fn();
    return response;
  } catch (error: unknown) {
    // 如果错误包含状态码信息，检查是否应该重试
    if (error instanceof Error && typeof error.message === "string") {
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
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return retryFetch(fn, { retries: retries - 1, delayMs: delayMs * 2 });
    }
    throw error;
  }
}

async function requestDomainCollection(
  providerId: string,
  apiKeyOverride?: string,
): Promise<Domain[]> {
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

  const data = (await response.json()) as HydraCollection<Domain>;

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
      DEFAULT_PROVIDER_ID,
      options.apiKeyOverride,
    );
    const availableDomains = domainCollection.filter((domain) => domain.isVerified);

    return availableDomains.map((domain) => ({
      ...domain,
      providerId: providerId || DEFAULT_PROVIDER_ID,
    }));
  } catch {
    return [];
  }
}

export async function fetchAllDomains(): Promise<Domain[]> {
  return fetchDomainsFromProvider(DEFAULT_PROVIDER_ID);
}

// 保持向后兼容的函数
export async function fetchDomains(): Promise<Domain[]> {
  return fetchAllDomains();
}

export async function fetchManagedDomains(
  providerId = DEFAULT_PROVIDER_ID,
): Promise<Domain[]> {
  const headers = createHeadersWithAdminSession(
    { "Cache-Control": "no-cache" },
    providerId,
  )
  const res = await fetch(buildProxyUrl("/domains"), {
    headers,
    cache: "no-store",
  })

  await ensureAdminSessionResponse(res)

  const data = (await res.json()) as HydraCollection<Domain>
  const domains = Array.isArray(data["hydra:member"]) ? data["hydra:member"] : []

  return domains.map((domain) => normalizeManagedDomainResponse(domain, providerId))
}

async function probeServiceEndpoint(
  endpoint: "/readyz" | "/healthz",
  providerId: string,
  status: ServiceStatusResponse["status"],
): Promise<ServiceStatusResponse | null> {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(
    () => controller.abort(),
    SERVICE_STATUS_REQUEST_TIMEOUT_MS,
  )

  try {
    const response = await fetch(buildProxyUrl(endpoint), {
      headers: createBaseHeaders(providerId),
      cache: "no-store",
      signal: controller.signal,
    })

    if (!response.ok) {
      return null
    }

    const payload = (await response.json().catch(() => null)) as
      | { storeBackend?: unknown }
      | null

    return {
      status,
      storeBackend:
        typeof payload?.storeBackend === "string"
          ? payload.storeBackend
          : undefined,
    }
  } catch {
    return null
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

export async function getServiceStatus(
  providerId = DEFAULT_PROVIDER_ID,
): Promise<ServiceStatusResponse> {
  const readyProbe = probeServiceEndpoint("/readyz", providerId, "ready")
  const healthProbe = probeServiceEndpoint("/healthz", providerId, "degraded")
  const readyStatus = await readyProbe

  if (readyStatus) {
    return readyStatus
  }

  const healthStatus = await healthProbe
  if (healthStatus) {
    return healthStatus
  }

  return { status: "offline" }
}

export const fetchServiceStatus = getServiceStatus

export async function fetchPublicUpdateNotice(
  providerId = DEFAULT_PROVIDER_ID,
): Promise<PublicUpdateNotice | null> {
  const headers = createBaseHeaders(providerId)
  const res = await fetch(buildProxyUrl("/site/update-notice"), {
    headers,
    cache: "no-store",
  })

  if (res.status === 404 || res.status === 405) {
    return null
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(getErrorMessage(res.status, error))
  }

  return res.json()
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

export async function getLinuxDoAuthorizationUrl(
  redirectUri: string,
  state: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<LinuxDoAuthorizeResponse> {
  const headers = createBaseHeaders(providerId)
  const endpoint = `/admin/linux-do/authorize?redirectUri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`
  const res = await fetch(buildProxyUrl(endpoint), {
    headers,
    cache: "no-store",
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(getErrorMessage(res.status, error))
  }

  return res.json()
}

export async function setupAdminPassword(
  payload: AdminBootstrapRequest,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<AdminSetupResponse> {
  const headers = {
    ...createBaseHeaders(providerId),
    "Content-Type": "application/json",
  };
  const res = await fetch(buildProxyUrl("/admin/setup"), {
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

export async function loginAdmin(
  payload: AdminLoginRequest,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<AdminSessionResponse> {
  const headers = {
    ...createBaseHeaders(providerId),
    "Content-Type": "application/json",
  };
  const res = await fetch(buildProxyUrl("/admin/login"), {
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

export async function registerConsole(
  payload: ConsoleRegisterRequest,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<AdminSessionResponse> {
  const headers = {
    ...createBaseHeaders(providerId),
    "Content-Type": "application/json",
  };
  const res = await fetch(buildProxyUrl("/admin/register"), {
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

export async function sendConsoleRegisterOtp(
  payload: SendEmailOtpRequest,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<SendEmailOtpResponse> {
  const headers = {
    ...createBaseHeaders(providerId),
    "Content-Type": "application/json",
  }
  const res = await fetch(buildProxyUrl("/admin/register/otp"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(getErrorMessage(res.status, error))
  }

  return res.json()
}

export async function completeLinuxDoLogin(
  payload: LinuxDoCompleteRequest,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<AdminSessionResponse> {
  const headers = {
    ...createBaseHeaders(providerId),
    "Content-Type": "application/json",
  }
  const res = await fetch(buildProxyUrl("/admin/linux-do/complete"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(getErrorMessage(res.status, error))
  }

  return res.json()
}

export async function validateAdminSession(
  providerId = DEFAULT_PROVIDER_ID,
): Promise<boolean> {
  const res = await requestAdminSessionResponse(providerId)

  if (res.ok) {
    return true;
  }

  if (res.status === 401 || res.status === 403) {
    clearStoredAdminSession();
    return false;
  }

  const error = await res.json().catch(() => ({}));
  throw new Error(getErrorMessage(res.status, error));
}

export async function getAdminSessionInfo(
  providerId = DEFAULT_PROVIDER_ID,
): Promise<AdminSessionInfo> {
  const res = await requestAdminSessionResponse(providerId)

  await ensureAdminSessionResponse(res)

  return res.json()
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
  providerId = DEFAULT_PROVIDER_ID,
): Promise<AdminAccessKeyInfoResponse> {
  const headers = createHeadersWithAdminSession({}, providerId);
  const res = await fetch(buildProxyUrl("/admin/access-key"), {
    headers,
    cache: "no-store",
  });

  await ensureAdminSessionResponse(res);

  return readJsonWithTimeout<AdminAccessKeyInfoResponse>(res);
}

export async function regenerateAdminAccessKey(
  providerId = DEFAULT_PROVIDER_ID,
): Promise<AdminAccessKeyResponse> {
  const headers = createHeadersWithAdminSession(
    { "Content-Type": "application/json" },
    providerId,
  );
  const res = await fetch(buildProxyUrl("/admin/access-key/regenerate"), {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });

  await ensureAdminSessionResponse(res);

  return readJsonWithTimeout<AdminAccessKeyResponse>(res);
}

export async function fetchAdminAccessKeys(
  providerId = DEFAULT_PROVIDER_ID,
): Promise<AdminAccessKeyListResponse> {
  const headers = createHeadersWithAdminSession({}, providerId)
  const res = await fetch(buildProxyUrl("/admin/access-keys"), {
    headers,
    cache: "no-store",
  })

  await ensureAdminSessionResponse(res)

  return readJsonWithTimeout<AdminAccessKeyListResponse>(res)
}

export async function createAdminAccessKey(
  payload: AdminCreateAccessKeyRequest,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<AdminAccessKeyResponse> {
  const headers = createHeadersWithAdminSession(
    { "Content-Type": "application/json" },
    providerId,
  )
  const res = await fetch(buildProxyUrl("/admin/access-keys"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  await ensureAdminSessionResponse(res)

  return readJsonWithTimeout<AdminAccessKeyResponse>(res)
}

export async function deleteAdminAccessKey(
  keyId: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<void> {
  const headers = createHeadersWithAdminSession({}, providerId)
  const res = await fetch(buildProxyUrl(`/admin/access-keys/${keyId}`), {
    method: "DELETE",
    headers,
  })

  await ensureAdminSessionResponse(res)
}

export async function updateAdminPassword(
  currentPassword: string,
  newPassword: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<void> {
  const headers = createHeadersWithAdminSession(
    { "Content-Type": "application/json" },
    providerId,
  );
  const res = await fetch(buildProxyUrl("/admin/password"), {
    method: "POST",
    headers,
    body: JSON.stringify({ currentPassword, newPassword }),
  });

  await ensureAdminSessionResponse(res);
  clearStoredAdminSession();
}

export async function fetchAdminUsers(
  providerId = DEFAULT_PROVIDER_ID,
): Promise<ConsoleUser[]> {
  const headers = createHeadersWithAdminSession({}, providerId)
  const res = await fetch(buildProxyUrl("/admin/users"), {
    headers,
    cache: "no-store",
  })

  await ensureAdminSessionResponse(res)

  return res.json()
}

export async function createAdminUser(
  payload: AdminCreateUserRequest,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<ConsoleUser> {
  const headers = createHeadersWithAdminSession(
    { "Content-Type": "application/json" },
    providerId,
  )
  const res = await fetch(buildProxyUrl("/admin/users"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  await ensureAdminSessionResponse(res)

  return res.json()
}

export async function updateAdminUser(
  userId: string,
  payload: AdminUpdateUserRequest,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<ConsoleUser> {
  const headers = createHeadersWithAdminSession(
    { "Content-Type": "application/json" },
    providerId,
  )
  const res = await fetch(buildProxyUrl(`/admin/users/${userId}`), {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  })

  await ensureAdminSessionResponse(res)

  return res.json()
}

export async function deleteAdminUser(
  userId: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<void> {
  const headers = createHeadersWithAdminSession({}, providerId)
  const res = await fetch(buildProxyUrl(`/admin/users/${userId}`), {
    method: "DELETE",
    headers,
  })

  await ensureAdminSessionResponse(res)
}

export async function resetAdminUserPassword(
  userId: string,
  payload: AdminResetUserPasswordRequest,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<void> {
  const headers = createHeadersWithAdminSession(
    { "Content-Type": "application/json" },
    providerId,
  )
  const res = await fetch(buildProxyUrl(`/admin/users/${userId}/password`), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  await ensureAdminSessionResponse(res)
}

export async function fetchAdminSystemSettings(
  providerId = DEFAULT_PROVIDER_ID,
): Promise<AdminSystemSettings> {
  const headers = createHeadersWithAdminSession({}, providerId)
  const res = await fetch(buildProxyUrl("/admin/settings"), {
    headers,
    cache: "no-store",
  })

  await ensureAdminSessionResponse(res)

  return res.json()
}

export async function updateAdminSystemSettings(
  payload: AdminUpdateSystemSettingsRequest,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<AdminSystemSettings> {
  const headers = createHeadersWithAdminSession(
    { "Content-Type": "application/json" },
    providerId,
  )
  const res = await fetch(buildProxyUrl("/admin/settings"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  await ensureAdminSessionResponse(res)

  return res.json()
}

export async function getAdminMetrics(
  providerId = DEFAULT_PROVIDER_ID,
): Promise<AdminMetricsResponse> {
  const headers = createHeadersWithAdminSession({}, providerId);
  const res = await fetch(buildProxyUrl("/admin/metrics"), {
    headers,
    cache: "no-store",
  });

  await ensureAdminSessionResponse(res);

  return res.json();
}

export async function getAdminAuditLogs(
  providerId = DEFAULT_PROVIDER_ID,
  limit = 50,
): Promise<AdminAuditLogsResponse> {
  const headers = createHeadersWithAdminSession({}, providerId);
  const res = await fetch(
    buildProxyUrl(`/admin/audit-logs?limit=${encodeURIComponent(limit)}`),
    {
      headers,
      cache: "no-store",
    },
  );

  await ensureAdminSessionResponse(res);

  return res.json();
}

export async function clearAdminAuditLogs(
  providerId = DEFAULT_PROVIDER_ID,
): Promise<void> {
  const headers = createHeadersWithAdminSession({}, providerId);
  const res = await fetch(buildProxyUrl("/admin/audit-logs"), {
    method: "DELETE",
    headers,
  });

  await ensureAdminSessionResponse(res);
}

export async function runAdminCleanup(
  providerId = DEFAULT_PROVIDER_ID,
): Promise<CleanupRunResponse> {
  const headers = createHeadersWithAdminSession(
    { "Content-Type": "application/json" },
    providerId,
  );
  const res = await fetch(buildProxyUrl("/admin/cleanup"), {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });

  await ensureAdminSessionResponse(res);

  return res.json();
}

export async function createManagedDomain(
  domain: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<Domain> {
  const headers = createHeadersWithAdminSession(
    { "Content-Type": "application/json" },
    providerId,
  );
  const res = await fetch(buildProxyUrl("/domains"), {
    method: "POST",
    headers,
    body: JSON.stringify({ domain }),
  });

  await ensureAdminSessionResponse(res);

  const createdDomain = await res.json();
  return normalizeManagedDomainResponse(createdDomain, providerId)
}

export async function getManagedDomainRecords(
  domainId: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<DomainDnsRecord[]> {
  const headers = createHeadersWithAdminSession({}, providerId);
  const res = await fetch(buildProxyUrl(`/domains/${domainId}/records`), {
    headers,
  });

  await ensureAdminSessionResponse(res);

  return res.json();
}

export async function verifyManagedDomain(
  domainId: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<Domain> {
  const headers = createHeadersWithAdminSession(
    { "Content-Type": "application/json" },
    providerId,
  );
  const res = await fetch(buildProxyUrl(`/domains/${domainId}/verify`), {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });

  await ensureAdminSessionResponse(res);

  const verifiedDomain = await res.json();
  return normalizeManagedDomainResponse(verifiedDomain, providerId)
}

export async function deleteManagedDomain(
  domainId: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<void> {
  const headers = createHeadersWithAdminSession({}, providerId);
  const res = await fetch(buildProxyUrl(`/domains/${domainId}`), {
    method: "DELETE",
    headers,
  });

  await ensureAdminSessionResponse(res);
}

// 创建账户
// expiresIn: 账户有效期（秒）。0 或 -1 = 永不过期，undefined = 服务端默认 24h，正数 = 自定义秒数
export async function createAccount(
  address: string,
  password: string,
  providerId?: string,
  expiresIn?: number,
  otpCode?: string,
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
  const requestBody: Record<string, string | number> = { address, password };
  if (expiresIn !== undefined) {
    requestBody.expiresIn = expiresIn;
  }
  if (otpCode?.trim()) {
    requestBody.otpCode = otpCode.trim()
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

export async function sendMailboxRegisterOtp(
  payload: SendEmailOtpRequest,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<SendEmailOtpResponse> {
  const headers = {
    ...createBaseHeaders(providerId),
    "Content-Type": "application/json",
  }
  const res = await fetch(buildProxyUrl("/accounts/otp"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(getErrorMessage(res.status, error))
  }

  return res.json()
}

export async function createOwnedAccount(
  address: string,
  providerId = DEFAULT_PROVIDER_ID,
  expiresIn?: number,
): Promise<Account> {
  const headers = createHeadersWithAdminSession(
    { "Content-Type": "application/json" },
    providerId,
  )
  const requestBody: Record<string, string | number> = { address }
  if (expiresIn !== undefined) {
    requestBody.expiresIn = expiresIn
  }

  const res = await fetch(buildProxyUrl("/accounts"), {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  })

  await ensureAdminSessionResponse(res)

  return res.json()
}

export async function fetchOwnedAccounts(
  providerId = DEFAULT_PROVIDER_ID,
): Promise<Account[]> {
  const headers = createHeadersWithAdminSession({}, providerId)
  const res = await fetch(buildProxyUrl("/accounts"), {
    headers,
    cache: "no-store",
  })

  await ensureAdminSessionResponse(res)

  const payload = await res.json()
  return Array.isArray(payload?.["hydra:member"]) ? payload["hydra:member"] : []
}

export async function issueOwnedAccountToken(
  accountId: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<{ token: string; id: string }> {
  const headers = createHeadersWithAdminSession(
    { "Content-Type": "application/json" },
    providerId,
  )
  const res = await fetch(buildProxyUrl(`/accounts/${accountId}/token`), {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  })

  await ensureAdminSessionResponse(res)

  return res.json()
}

export async function fetchConsoleCloudflareSettings(
  providerId = DEFAULT_PROVIDER_ID,
): Promise<ConsoleCloudflareSettings> {
  const headers = createHeadersWithAdminSession({}, providerId)
  const res = await fetch(buildProxyUrl("/admin/cloudflare"), {
    headers,
    cache: "no-store",
  })

  await ensureAdminSessionResponse(res)

  return res.json()
}

export async function updateConsoleCloudflareSettings(
  payload: UpdateConsoleCloudflareSettingsRequest,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<ConsoleCloudflareSettings> {
  const headers = createHeadersWithAdminSession(
    { "Content-Type": "application/json" },
    providerId,
  )
  const res = await fetch(buildProxyUrl("/admin/cloudflare"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  await ensureAdminSessionResponse(res)

  return res.json()
}

export async function testConsoleCloudflareToken(
  apiToken?: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<CloudflareTokenValidationResponse> {
  const headers = createHeadersWithAdminSession(
    { "Content-Type": "application/json" },
    providerId,
  )
  const res = await fetch(buildProxyUrl("/admin/cloudflare/test"), {
    method: "POST",
    headers,
    body: JSON.stringify({ apiToken }),
  })

  await ensureAdminSessionResponse(res)

  return res.json()
}

export async function syncManagedDomainCloudflare(
  domainId: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<CloudflareDnsSyncResponse> {
  const headers = createHeadersWithAdminSession(
    { "Content-Type": "application/json" },
    providerId,
  )
  const res = await fetch(buildProxyUrl(`/domains/${domainId}/cloudflare/sync`), {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  })

  await ensureAdminSessionResponse(res)

  const response = await res.json()
  return {
    ...response,
    domain: response.domain
      ? normalizeManagedDomainResponse(response.domain, providerId)
      : undefined,
  }
}

export async function deleteOwnedAccount(
  accountId: string,
  providerId = DEFAULT_PROVIDER_ID,
): Promise<void> {
  const headers = createHeadersWithAdminSession({}, providerId)
  const res = await fetch(buildProxyUrl(`/accounts/${accountId}`), {
    method: "DELETE",
    headers,
  })

  await ensureAdminSessionResponse(res)
}

export async function deleteAdminSession(): Promise<void> {
  try {
    await fetch("/api/admin/session", {
      method: "DELETE",
      cache: "no-store",
    })
  } finally {
    clearStoredAdminSession()
  }
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
        const account = getCurrentAccountFromRuntime();
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
        // 尝试从运行时状态获取最新 token（可能已被刷新）
        const account = getCurrentAccountFromRuntime();
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
  }, { retries: 0 });

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
        const account = getCurrentAccountFromRuntime();
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
  }, { retries: 0 });

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
        const account = getCurrentAccountFromRuntime();
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
  }, { retries: 0 });

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
        const account = getCurrentAccountFromRuntime();
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
        const account = getCurrentAccountFromRuntime();
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
        const account = getCurrentAccountFromRuntime();
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
