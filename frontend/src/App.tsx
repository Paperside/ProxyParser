import { startTransition, useDeferredValue, useEffect, useState } from "react";

type ProxyStatus = {
  name: string;
  status: "success" | "failed";
  lastModified: string;
  proxyCount: number;
  groupCount: number;
  ruleCount: number;
  subscriptionUserInfo: string | null;
  error: string | null;
};

type ProxyMeta = ProxyStatus & {
  headers: Record<string, string>;
  groups: string[];
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");

const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
};

const formatTime = (value: string) => {
  return new Date(value).toLocaleString();
};

const formatAge = (value: string) => {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diff / (60 * 1000)));

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }

  return `${Math.floor(hours / 24)} d ago`;
};

export default function App() {
  const [statusList, setStatusList] = useState<ProxyStatus[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [selectedMeta, setSelectedMeta] = useState<ProxyMeta | null>(null);
  const [searchText, setSearchText] = useState("");
  const [isBooting, setIsBooting] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const deferredSearchText = useDeferredValue(searchText);

  const keyword = deferredSearchText.trim().toLowerCase();
  const filteredStatusList = !keyword
    ? statusList
    : statusList.filter((proxy) => proxy.name.toLowerCase().includes(keyword));

  const loadStatus = async () => {
    setErrorMessage(null);
    const nextStatus = await request<ProxyStatus[]>("/api/proxy/status");

    startTransition(() => {
      setStatusList(nextStatus);

      if (!nextStatus.some((proxy) => proxy.name === selectedName)) {
        setSelectedName(nextStatus[0]?.name ?? null);
      }
    });
  };

  const loadMeta = async (name: string) => {
    setIsLoadingMeta(true);

    try {
      const nextMeta = await request<ProxyMeta>(`/api/proxy/${name}/meta`);
      startTransition(() => {
        setSelectedMeta(nextMeta);
      });
    } finally {
      setIsLoadingMeta(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const nextStatus = await request<ProxyStatus[]>("/api/proxy/status");

        if (cancelled) {
          return;
        }

        startTransition(() => {
          setStatusList(nextStatus);
          setSelectedName((current) => current ?? nextStatus[0]?.name ?? null);
        });
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(String(error));
        }
      } finally {
        if (!cancelled) {
          setIsBooting(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedName) {
      setSelectedMeta(null);
      return;
    }

    let cancelled = false;

    const syncMeta = async () => {
      try {
        const nextMeta = await request<ProxyMeta>(`/api/proxy/${selectedName}/meta`);
        if (!cancelled) {
          startTransition(() => {
            setSelectedMeta(nextMeta);
          });
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(String(error));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingMeta(false);
        }
      }
    };

    setIsLoadingMeta(true);
    void syncMeta();

    return () => {
      cancelled = true;
    };
  }, [selectedName]);

  const refreshAll = async () => {
    setIsRefreshing(true);
    setErrorMessage(null);

    try {
      const nextStatus = await request<ProxyStatus[]>("/api/proxy/refresh", {
        method: "POST"
      });

      startTransition(() => {
        setStatusList(nextStatus);

        if (!nextStatus.some((proxy) => proxy.name === selectedName)) {
          setSelectedName(nextStatus[0]?.name ?? null);
        }
      });

      if (selectedName) {
        await loadMeta(selectedName);
      }
    } catch (error) {
      setErrorMessage(String(error));
    } finally {
      setIsRefreshing(false);
    }
  };

  const refreshSelected = async () => {
    if (!selectedName) {
      return;
    }

    setIsRefreshing(true);
    setErrorMessage(null);

    try {
      const nextMeta = await request<ProxyMeta>(`/api/proxy/${selectedName}/refresh`, {
        method: "POST"
      });

      startTransition(() => {
        setSelectedMeta(nextMeta);
        setStatusList((current) =>
          current.map((item) => (item.name === selectedName ? nextMeta : item))
        );
      });
    } catch (error) {
      setErrorMessage(String(error));
    } finally {
      setIsRefreshing(false);
    }
  };

  const successCount = statusList.filter((proxy) => proxy.status === "success").length;
  const totalRules = statusList[0]?.ruleCount ?? 0;

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Bun Monorepo Dashboard</p>
          <h1>ProxyParser</h1>
          <p className="hero-copy">
            Watch subscription health, inspect generated proxy groups, and refresh patched
            configs without dropping back to the terminal.
          </p>
        </div>
        <div className="hero-stats">
          <article>
            <span>Subscriptions</span>
            <strong>{statusList.length}</strong>
          </article>
          <article>
            <span>Healthy</span>
            <strong>{successCount}</strong>
          </article>
          <article>
            <span>Rules Loaded</span>
            <strong>{totalRules}</strong>
          </article>
        </div>
      </section>

      <section className="toolbar">
        <label className="search-box">
          <span>Filter</span>
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search subscription name"
          />
        </label>

        <div className="actions">
          <button onClick={refreshAll} disabled={isRefreshing || isBooting}>
            {isRefreshing ? "Refreshing..." : "Refresh all"}
          </button>
          <button
            className="secondary"
            onClick={refreshSelected}
            disabled={!selectedName || isRefreshing || isBooting}
          >
            Refresh selected
          </button>
        </div>
      </section>

      {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}

      <section className="content-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Subscriptions</p>
              <h2>Current status</h2>
            </div>
            <span className="muted">
              {isBooting ? "Loading..." : `${filteredStatusList.length} shown`}
            </span>
          </div>

          <div className="subscription-list">
            {filteredStatusList.map((proxy) => (
              <button
                key={proxy.name}
                type="button"
                className={`subscription-card ${proxy.name === selectedName ? "active" : ""}`}
                onClick={() => setSelectedName(proxy.name)}
              >
                <div className="subscription-header">
                  <strong>{proxy.name}</strong>
                  <span className={`status-pill ${proxy.status}`}>{proxy.status}</span>
                </div>
                <p>{proxy.proxyCount} nodes</p>
                <p>{proxy.groupCount} groups</p>
                <p className="muted">{formatAge(proxy.lastModified)}</p>
              </button>
            ))}

            {!isBooting && filteredStatusList.length === 0 ? (
              <p className="empty-state">No subscriptions match the current filter.</p>
            ) : null}
          </div>
        </article>

        <article className="panel detail-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Inspection</p>
              <h2>{selectedMeta?.name ?? "Select a subscription"}</h2>
            </div>
            <span className="muted">
              {isLoadingMeta ? "Fetching details..." : selectedMeta?.status ?? "Idle"}
            </span>
          </div>

          {selectedMeta ? (
            <>
              <div className="detail-grid">
                <article>
                  <span>Last refresh</span>
                  <strong>{formatTime(selectedMeta.lastModified)}</strong>
                </article>
                <article>
                  <span>Proxy nodes</span>
                  <strong>{selectedMeta.proxyCount}</strong>
                </article>
                <article>
                  <span>Generated groups</span>
                  <strong>{selectedMeta.groupCount}</strong>
                </article>
                <article>
                  <span>User info</span>
                  <strong>{selectedMeta.subscriptionUserInfo ?? "Unavailable"}</strong>
                </article>
              </div>

              <div className="detail-block">
                <h3>Generated groups</h3>
                <div className="tag-list">
                  {selectedMeta.groups.map((group) => (
                    <span key={group} className="tag">
                      {group}
                    </span>
                  ))}
                </div>
              </div>

              <div className="detail-block">
                <h3>Response headers</h3>
                <pre>
                  {JSON.stringify(selectedMeta.headers, null, 2)}
                </pre>
              </div>
            </>
          ) : (
            <p className="empty-state">Choose one subscription to inspect its generated metadata.</p>
          )}
        </article>
      </section>
    </main>
  );
}
