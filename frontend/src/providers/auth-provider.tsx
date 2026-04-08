import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren
} from "react";

import { API_BASE_URL, parseErrorMessage, requestJson } from "../lib/api";
import type { LoginResponse, RegisterResponse, Session, User } from "../lib/types";

const SESSION_STORAGE_KEY = "proxyparser.session";
const REVEALED_SECRET_STORAGE_KEY = "proxyparser.revealed-subscription-secret";

const buildSession = (response: LoginResponse | RegisterResponse): Session => {
  return {
    user: response.user,
    accessToken: response.tokens.accessToken,
    accessTokenExpiresAt: response.tokens.accessTokenExpiresAt,
    refreshToken: response.tokens.refreshToken,
    refreshTokenExpiresAt: response.tokens.refreshTokenExpiresAt
  };
};

interface RevealedSecretRecord {
  userId: string;
  secret: string;
}

const readRevealedSecretRecord = () => {
  const raw = localStorage.getItem(REVEALED_SECRET_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as RevealedSecretRecord;
  } catch {
    return null;
  }
};

export interface AuthContextValue {
  session: Session | null;
  isBooting: boolean;
  revealedSubscriptionSecret: string | null;
  login: (input: { login: string; password: string }) => Promise<void>;
  register: (input: {
    email: string;
    username: string;
    displayName?: string;
    password: string;
  }) => Promise<string>;
  logout: () => Promise<void>;
  authorizedRequest: <T,>(path: string, init?: RequestInit) => Promise<T>;
  updateCurrentUser: (input: { displayName?: string; locale?: string }) => Promise<User>;
  rememberSubscriptionSecret: (secret: string | null, userId?: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [session, setSession] = useState<Session | null>(() => {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as Session;
    } catch {
      return null;
    }
  });
  const [isBooting, setIsBooting] = useState(true);
  const [revealedSecretRecord, setRevealedSecretRecord] = useState<RevealedSecretRecord | null>(
    () => readRevealedSecretRecord()
  );
  const sessionRef = useRef<Session | null>(session);

  const saveSession = (nextSession: Session | null) => {
    sessionRef.current = nextSession;
    setSession(nextSession);

    if (nextSession) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  };

  const rememberSubscriptionSecret = (secret: string | null, userId = sessionRef.current?.user.id) => {
    if (!secret || !userId) {
      setRevealedSecretRecord(null);
      localStorage.removeItem(REVEALED_SECRET_STORAGE_KEY);
      return;
    }

    const nextRecord = {
      userId,
      secret
    };

    setRevealedSecretRecord(nextRecord);
    localStorage.setItem(REVEALED_SECRET_STORAGE_KEY, JSON.stringify(nextRecord));
  };

  const refreshSession = async (refreshToken: string) => {
    const refreshed = await requestJson<LoginResponse>("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({
        refreshToken
      })
    });
    const nextSession = buildSession(refreshed);
    saveSession(nextSession);
    return nextSession;
  };

  useEffect(() => {
    const bootstrap = async () => {
      const current = sessionRef.current;

      if (!current) {
        setIsBooting(false);
        return;
      }

      try {
        const me = await fetch(`${API_BASE_URL}/api/me`, {
          headers: {
            Authorization: `Bearer ${current.accessToken}`
          }
        });

        if (me.ok) {
          const payload = (await me.json()) as { user: User };
          saveSession({
            ...current,
            user: payload.user
          });
        } else {
          const nextSession = await refreshSession(current.refreshToken);
          const verified = await fetch(`${API_BASE_URL}/api/me`, {
            headers: {
              Authorization: `Bearer ${nextSession.accessToken}`
            }
          });

          if (!verified.ok) {
            throw new Error(await parseErrorMessage(verified));
          }

          const payload = (await verified.json()) as { user: User };
          saveSession({
            ...nextSession,
            user: payload.user
          });
        }
      } catch {
        saveSession(null);
      } finally {
        setIsBooting(false);
      }
    };

    void bootstrap();
  }, []);

  const authorizedRequest = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const current = sessionRef.current;

    if (!current) {
      throw new Error("请先登录。");
    }

    const attempt = async (accessToken: string) => {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          ...(init?.headers ?? {})
        }
      });

      if (response.ok) {
        if (response.status === 204) {
          return null as T;
        }

        return response.json() as Promise<T>;
      }

      if (response.status === 401) {
        throw new Error("UNAUTHORIZED");
      }

      throw new Error(await parseErrorMessage(response));
    };

    try {
      return await attempt(current.accessToken);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "UNAUTHORIZED") {
        throw error;
      }

      const nextSession = await refreshSession(current.refreshToken);
      return attempt(nextSession.accessToken);
    }
  };

  const login = async (input: { login: string; password: string }) => {
    const result = await requestJson<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input)
    });

    saveSession(buildSession(result));
  };

  const register = async (input: {
    email: string;
    username: string;
    displayName?: string;
    password: string;
  }) => {
    const result = await requestJson<RegisterResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(input)
    });

    saveSession(buildSession(result));
    rememberSubscriptionSecret(result.subscriptionSecret, result.user.id);
    return result.subscriptionSecret;
  };

  const logout = async () => {
    const current = sessionRef.current;

    if (!current) {
      return;
    }

    try {
      await requestJson<{ success: boolean }>("/api/auth/logout", {
        method: "POST",
        body: JSON.stringify({
          refreshToken: current.refreshToken
        })
      });
    } finally {
      saveSession(null);
    }
  };

  const updateCurrentUser = async (input: { displayName?: string; locale?: string }) => {
    const result = await authorizedRequest<{ user: User }>("/api/me", {
      method: "PATCH",
      body: JSON.stringify(input)
    });

    if (sessionRef.current) {
      saveSession({
        ...sessionRef.current,
        user: result.user
      });
    }

    return result.user;
  };

    const value = useMemo<AuthContextValue>(() => {
    const revealedSubscriptionSecret =
      session && revealedSecretRecord?.userId === session.user.id ? revealedSecretRecord.secret : null;

    return {
      session,
      isBooting,
      revealedSubscriptionSecret,
      login,
      register,
      logout,
      authorizedRequest,
      updateCurrentUser,
      rememberSubscriptionSecret
    };
  }, [session, isBooting, revealedSecretRecord]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return context;
};
