"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import type { Account, AuthState } from "@/types";
import {
  MAILBOX_TOKEN_REFRESHED_EVENT,
  clearLegacyStoredMailboxAuth,
  createAccount,
  deleteAccount as deleteAccountApi,
  getAccount,
  getToken,
  syncRuntimeMailboxAuthState,
} from "@/lib/api";
import { DEFAULT_PROVIDER_ID } from "@/lib/provider-config";

interface AuthContextType extends AuthState {
  login: (address: string, password: string) => Promise<void>;
  logout: () => void;
  register: (
    address: string,
    password: string,
    expiresIn?: number,
    otpCode?: string,
  ) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;
  switchAccount: (account: Account) => Promise<void>;
  addAccount: (account: Account, token: string, password?: string) => void;
  syncAccounts: (accounts: Account[]) => void;
  activateAccount: (account: Account, token: string) => void;
  clearAccounts: () => void;
  getAccountsForProvider: (providerId: string) => Account[];
  getCurrentProviderAccounts: () => Account[];
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function dedupeAccounts(accounts: Account[]): Account[] {
  const seen = new Set<string>();
  const nextAccounts: Account[] = [];

  for (const account of accounts) {
    const key = `${account.id}:${account.address.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    nextAccounts.push(account);
  }

  return nextAccounts;
}

function loadInitialAuthState(): AuthState {
  clearLegacyStoredMailboxAuth();

  return {
    token: null,
    currentAccount: null,
    accounts: [],
    isAuthenticated: false,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("auth");
  const [authState, setAuthState] = useState<AuthState>(() => loadInitialAuthState());

  const getProviderIdFromEmail = useCallback(() => DEFAULT_PROVIDER_ID, []);

  useLayoutEffect(() => {
    syncRuntimeMailboxAuthState(authState);
  }, [authState]);

  // 监听 token 刷新事件，同步更新 React state
  useEffect(() => {
    const handleTokenRefreshed = (event: Event) => {
      const newToken = (event as CustomEvent<{ token?: string }>).detail?.token;
      if (!newToken) {
        return;
      }

      setAuthState((prev) => {
        if (!prev.currentAccount) return prev;

        const updatedCurrentAccount = {
          ...prev.currentAccount,
          token: newToken,
        };

        const updatedAccounts = prev.accounts.map((acc) =>
          acc.address === prev.currentAccount?.address
            ? { ...acc, token: newToken }
            : acc,
        );

        return {
          ...prev,
          token: newToken,
          currentAccount: updatedCurrentAccount,
          accounts: updatedAccounts,
        };
      });
    };

    window.addEventListener(
      MAILBOX_TOKEN_REFRESHED_EVENT,
      handleTokenRefreshed as EventListener,
    );
    return () => {
      window.removeEventListener(
        MAILBOX_TOKEN_REFRESHED_EVENT,
        handleTokenRefreshed as EventListener,
      );
    };
  }, []);

  const login = useCallback(async (address: string, password: string) => {
    try {
      const { token } = await getToken(address, password);
      const providerId = getProviderIdFromEmail();
      const account = await getAccount(token, providerId);

      // 添加密码、token和providerId到账户信息
      const accountWithAuth = {
        ...account,
        password,
        token,
        providerId,
      };

      setAuthState((prev) => {
        const existingAccountIndex = prev.accounts.findIndex(
          (acc) => acc.address === account.address,
        );

        const updatedAccounts =
          existingAccountIndex !== -1
            ? prev.accounts.map((acc, index) =>
                index === existingAccountIndex ? accountWithAuth : acc,
              )
            : [...prev.accounts, accountWithAuth];

        return {
          token,
          currentAccount: accountWithAuth,
          accounts: dedupeAccounts(updatedAccounts),
          isAuthenticated: true,
        };
      });
    } catch (error) {
      console.error("Login failed:", error);
      throw error;
    }
  }, [getProviderIdFromEmail]);

  const register = useCallback(async (
    address: string,
    password: string,
    expiresIn?: number,
    otpCode?: string,
  ) => {
    try {
      const providerId = getProviderIdFromEmail();
      await createAccount(address, password, providerId, expiresIn, otpCode);
      // 注册成功后直接登录
      await login(address, password);
    } catch (error) {
      console.error("Registration failed:", error);
      throw error;
    }
  }, [getProviderIdFromEmail, login]);

  const logout = useCallback(() => {
    const { currentAccount, accounts } = authState;

    // 没有当前账户时，直接清除认证状态但保留账户列表
    if (!currentAccount) {
      setAuthState({
        ...authState,
        token: null,
        isAuthenticated: false,
      });
      return;
    }

    // 从账户列表中彻底移除当前账户，避免在内存态里继续保留无效凭据
    const remainingAccounts = accounts.filter(
      (account) => account.id !== currentAccount.id,
    );

    // 如果还有其他账户，则自动切换到下一个账户，避免回到首页
    if (remainingAccounts.length > 0) {
      const nextAccount = remainingAccounts[0];

      setAuthState({
        token: nextAccount.token || null,
        currentAccount: nextAccount,
        accounts: remainingAccounts,
        isAuthenticated: !!nextAccount.token,
      });
    } else {
      // 只有当前一个账户时，真正退出到未登录状态，并清空账户列表
      setAuthState({
        token: null,
        currentAccount: null,
        accounts: [],
        isAuthenticated: false,
      });
    }
  }, [authState]);

  const switchAccount = useCallback(async (account: Account) => {
    try {
      const accountProviderId = account.providerId || DEFAULT_PROVIDER_ID;

      // 如果既没有 token 也没有密码，直接报错，不修改当前状态
      if (!account.token && !account.password) {
        throw new Error(t("missingCredentials"));
      }

      const applyAccountWithAuth = (
        accountWithAuth: Account,
        token: string,
      ) => {
        setAuthState((prev) => {
          const updatedAccounts = prev.accounts.map((acc) =>
            acc.address === account.address ? accountWithAuth : acc,
          );

          return {
            token,
            currentAccount: accountWithAuth,
            accounts: updatedAccounts,
            isAuthenticated: true,
          };
        });
      };

      if (account.token) {
        try {
          // 先尝试用现有 token 获取账户信息
          const updatedAccount = await getAccount(
            account.token,
            accountProviderId,
          );
          const accountWithAuth = {
            ...updatedAccount,
            password: account.password,
            token: account.token,
            providerId: accountProviderId,
          };

          applyAccountWithAuth(accountWithAuth, account.token);
          return;
        } catch {
          // Token 无效，如果有密码则尝试重新获取 token
          if (account.password) {
            try {
              const { token } = await getToken(
                account.address,
                account.password,
                accountProviderId,
              );
              const updatedAccount = await getAccount(token, accountProviderId);

              const accountWithAuth = {
                ...updatedAccount,
                password: account.password,
                token,
                providerId: accountProviderId,
              };

              applyAccountWithAuth(accountWithAuth, token);
              return;
            } catch {
              // 刷新失败时，仅清理该账号的 token，保持当前登录状态不变
              setAuthState((prev) => ({
                ...prev,
                accounts: prev.accounts.map((acc) =>
                  acc.address === account.address
                    ? { ...acc, token: undefined }
                    : acc,
                ),
              }));
              throw new Error(t("tokenRefreshFailed"));
            }
          } else {
            // 没有密码无法刷新 token，只清理该账号的 token
            setAuthState((prev) => ({
              ...prev,
              accounts: prev.accounts.map((acc) =>
                acc.address === account.address
                  ? { ...acc, token: undefined }
                  : acc,
              ),
            }));
            throw new Error(t("tokenExpired"));
          }
        }
      }

      if (account.password) {
        // 没有 token 但有密码，在后台获取新的 token
        try {
          const { token } = await getToken(
            account.address,
            account.password,
            accountProviderId,
          );
          const updatedAccount = await getAccount(token, accountProviderId);

          const accountWithAuth = {
            ...updatedAccount,
            password: account.password,
            token,
            providerId: accountProviderId,
          };

          applyAccountWithAuth(accountWithAuth, token);
          return;
        } catch {
          throw new Error(t("credentialFetchFailed"));
        }
      }
    } catch (error) {
      console.error("Switch account failed:", error);
      throw error;
    }
  }, [t]);

  const deleteAccount = useCallback(async (id: string) => {
    try {
      const { currentAccount, accounts, token } = authState;

      // 调用后端删除接口，确保账号真的被删除
      const targetAccount = accounts.find((account) => account.id === id);
      const providerId = targetAccount?.providerId || DEFAULT_PROVIDER_ID;

      const deleteToken =
        currentAccount?.id === id ? token : targetAccount?.token;

      if (!deleteToken) {
        throw new Error(t("missingDeleteCredentials"));
      }

      await deleteAccountApi(deleteToken, id, providerId);

      const remainingAccounts = accounts.filter((account) => account.id !== id);
      const isDeletingCurrent = currentAccount?.id === id;

      // 如果删除的不是当前账户，只更新账户列表即可
      if (!isDeletingCurrent) {
        setAuthState((prev) => ({
          ...prev,
          accounts: remainingAccounts,
        }));
        return;
      }

      // 删除的是当前账户
      if (remainingAccounts.length === 0) {
        // 删除的是最后一个账户，回到未登录状态
        setAuthState({
          token: null,
          currentAccount: null,
          accounts: [],
          isAuthenticated: false,
        });
        return;
      }

      // 删除的是当前账户，但还有其他账户：
      // 1）先清除当前无效 token，并保存剩余账户
      setAuthState((prev) => ({
        ...prev,
        token: null,
        currentAccount: null,
        accounts: remainingAccounts,
        isAuthenticated: false,
      }));

      // 2）优先选择仍然有凭据的账户尝试自动切换
      const candidate =
        remainingAccounts.find(
          (account) => account.token || account.password,
        ) || remainingAccounts[0];

      try {
        await switchAccount(candidate);
      } catch (switchError) {
        // 自动切换失败：保持未登录状态，但保留 remainingAccounts，方便用户手动登录
        console.error("Auto switch after delete failed:", switchError);
      }
    } catch (error) {
      console.error("Delete account failed:", error);
      throw error;
    }
  }, [authState, switchAccount, t]);

  const addAccount = useCallback((account: Account, token: string, password?: string) => {
    const providerId = getProviderIdFromEmail();
    const accountWithAuth = {
      ...account,
      password,
      token,
      providerId,
    };

    setAuthState((prev) => ({
      token,
      currentAccount: accountWithAuth,
      accounts: dedupeAccounts([...prev.accounts, accountWithAuth]),
      isAuthenticated: true,
    }));
  }, [getProviderIdFromEmail]);

  const syncAccounts = useCallback((accounts: Account[]) => {
    setAuthState((prev) => {
      const nextAccounts = dedupeAccounts(
        accounts.map((account) => {
          const existing =
            prev.accounts.find((item) => item.id === account.id) ||
            prev.accounts.find((item) => item.address === account.address)

          return {
            ...account,
            password: existing?.password,
            token: existing?.token,
            providerId: account.providerId || existing?.providerId || DEFAULT_PROVIDER_ID,
          }
        }),
      )

      const currentAccount = prev.currentAccount
        ? nextAccounts.find((account) => account.id === prev.currentAccount?.id) || null
        : null
      const token = currentAccount?.token || null

      return {
        token,
        currentAccount,
        accounts: nextAccounts,
        isAuthenticated: Boolean(token && currentAccount),
      }
    })
  }, [])

  const activateAccount = useCallback((account: Account, token: string) => {
    setAuthState((prev) => {
      const existingAccount =
        prev.accounts.find((item) => item.id === account.id) ||
        prev.accounts.find((item) => item.address === account.address) ||
        (prev.currentAccount?.id === account.id || prev.currentAccount?.address === account.address
          ? prev.currentAccount
          : null)

      const accountWithAuth = {
        ...existingAccount,
        ...account,
        password: account.password ?? existingAccount?.password,
        token,
        providerId:
          account.providerId || existingAccount?.providerId || DEFAULT_PROVIDER_ID,
      }

      const existingIndex = prev.accounts.findIndex((item) => item.id === account.id)
      const accounts =
        existingIndex >= 0
          ? prev.accounts.map((item, index) => (index === existingIndex ? accountWithAuth : item))
          : [...prev.accounts, accountWithAuth]

      return {
        token,
        currentAccount: accountWithAuth,
        accounts: dedupeAccounts(accounts),
        isAuthenticated: true,
      }
    })
  }, [])

  const clearAccounts = useCallback(() => {
    setAuthState({
      token: null,
      currentAccount: null,
      accounts: [],
      isAuthenticated: false,
    })
  }, [])

  // 获取指定提供商的账户
  const getAccountsForProvider = useCallback((providerId: string): Account[] => {
    return authState.accounts.filter(
      (account) => (account.providerId || DEFAULT_PROVIDER_ID) === providerId,
    );
  }, [authState.accounts]);

  // 获取当前账户的提供商的所有账户
  const getCurrentProviderAccounts = useCallback((): Account[] => {
    if (!authState.currentAccount) return [];
    const currentProviderId =
      authState.currentAccount.providerId || DEFAULT_PROVIDER_ID;
    return getAccountsForProvider(currentProviderId);
  }, [authState.currentAccount, getAccountsForProvider]);

  const contextValue = useMemo(
    () => ({
      ...authState,
      login,
      logout,
      register,
      deleteAccount,
      switchAccount,
      addAccount,
      syncAccounts,
      activateAccount,
      clearAccounts,
      getAccountsForProvider,
      getCurrentProviderAccounts,
    }),
    [
      activateAccount,
      addAccount,
      authState,
      clearAccounts,
      deleteAccount,
      getAccountsForProvider,
      getCurrentProviderAccounts,
      login,
      logout,
      register,
      switchAccount,
      syncAccounts,
    ],
  );

  return (
    <AuthContext.Provider
      value={contextValue}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
