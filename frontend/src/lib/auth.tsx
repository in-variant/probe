"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export interface User {
  email: string;
  name: string;
  picture: string;
  role?: "ADMIN" | "CLIENT" | "INVARIANT";
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  loading: true,
  login: () => {},
  logout: () => {},
});

const TOKEN_KEY = "probe_auth_token";
const USER_KEY = "probe_auth_user";

async function fetchLoginUrl(): Promise<{ url: string; flow_id: string }> {
  const origin = window.location.origin;
  const params = new URLSearchParams({ origin });
  const res = await fetch(`/api/auth/login?${params}`);
  if (!res.ok) throw new Error("Failed to get login URL");
  return res.json();
}

async function exchangeAuthCode(
  code: string,
  flowId: string
): Promise<{ session_token: string; user: User }> {
  const origin = window.location.origin;
  const res = await fetch("/api/auth/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, origin, flow_id: flowId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `Auth failed (${res.status})`);
  }
  return res.json();
}

async function fetchMe(token: string): Promise<User> {
  const res = await fetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Session expired");
  return res.json();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flowIdRef = useRef<string>("");

  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    if (!savedToken) {
      queueMicrotask(() => setLoading(false));
      return;
    }
    fetchMe(savedToken)
      .then((u) => {
        setToken(savedToken);
        setUser(u);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async () => {
    localStorage.removeItem("auth_callback_code");
    localStorage.removeItem("auth_callback_error");

    try {
      const { url, flow_id } = await fetchLoginUrl();
      flowIdRef.current = flow_id;
      const popup = window.open(url, "probe-auth", "width=520,height=680,popup=1");
      popupRef.current = popup;

      pollRef.current = setInterval(async () => {
        const code = localStorage.getItem("auth_callback_code");
        const error = localStorage.getItem("auth_callback_error");

        if (code) {
          localStorage.removeItem("auth_callback_code");
          if (pollRef.current) clearInterval(pollRef.current);
          if (popup && !popup.closed) popup.close();

          try {
            const { session_token, user: u } = await exchangeAuthCode(
              code,
              flowIdRef.current
            );
            localStorage.setItem(TOKEN_KEY, session_token);
            localStorage.setItem(USER_KEY, JSON.stringify(u));
            setToken(session_token);
            setUser(u);
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "Login failed";
            alert(message);
          }
          return;
        }

        if (error) {
          localStorage.removeItem("auth_callback_error");
          if (pollRef.current) clearInterval(pollRef.current);
          if (popup && !popup.closed) popup.close();
          return;
        }

        if (!popup || popup.closed) {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      }, 500);
    } catch {
      // login URL fetch failed
    }
  }, []);

  const logout = useCallback(async () => {
    if (token) {
      fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, [token]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}
