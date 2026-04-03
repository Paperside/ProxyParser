import type {
  ProxyFetchResult,
  ProxyStatusMeta,
  ProxyStatusSummary,
  SubscriptionConfig
} from "../types";
import { getPatchedProxy } from "../lib/proxy-patcher";
import { getFullRules } from "../lib/proxy-rules";

export class ProxyStore {
  private readonly urlMap = new Map<string, string>();
  private readonly staleAfterMs: number;
  private cache = new Map<string, ProxyFetchResult>();

  constructor(subscriptions: SubscriptionConfig[], staleAfterMs = 24 * 60 * 60 * 1000) {
    this.staleAfterMs = staleAfterMs;

    for (const subscription of subscriptions) {
      this.urlMap.set(subscription.name, subscription.url);
    }
  }

  async prime() {
    await this.refreshAll();
  }

  async list(): Promise<ProxyStatusSummary[]> {
    if (this.cache.size === 0) {
      await this.prime();
    }

    return [...this.cache.entries()]
      .map(([name, record]) => this.toSummary(name, record))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async getRules(): Promise<string[]> {
    return getFullRules();
  }

  async getMeta(name: string): Promise<ProxyStatusMeta | null> {
    const record = await this.getOrRefresh(name);
    return record ? this.toMeta(name, record) : null;
  }

  async getOrRefresh(name: string): Promise<ProxyFetchResult | null> {
    const url = this.urlMap.get(name);
    if (!url) {
      return null;
    }

    const current = this.cache.get(name);
    if (!current || current.status === "failed" || this.isStale(current)) {
      return this.refreshOne(name);
    }

    return current;
  }

  async refreshOne(name: string): Promise<ProxyFetchResult | null> {
    const url = this.urlMap.get(name);
    if (!url) {
      return null;
    }

    const next = await getPatchedProxy(url);
    this.cache.set(name, next);
    return next;
  }

  async refreshAll(): Promise<ProxyStatusSummary[]> {
    const entries = await Promise.all(
      [...this.urlMap.entries()].map(async ([name, url]) => {
        const record = await getPatchedProxy(url);
        return [name, record] as const;
      })
    );

    this.cache = new Map(entries);
    return this.list();
  }

  private isStale(record: ProxyFetchResult) {
    return Date.now() - record.lastModified.getTime() >= this.staleAfterMs;
  }

  private toSummary(name: string, record: ProxyFetchResult): ProxyStatusSummary {
    const data = record.data;

    return {
      name,
      status: record.status,
      lastModified: record.lastModified.toISOString(),
      proxyCount: data?.proxies.length ?? 0,
      groupCount: data?.["proxy-groups"].length ?? 0,
      ruleCount: data?.rules?.length ?? 0,
      subscriptionUserInfo: record.headers?.["subscription-userinfo"] ?? null,
      error: record.errMsg ?? null
    };
  }

  private toMeta(name: string, record: ProxyFetchResult): ProxyStatusMeta {
    const summary = this.toSummary(name, record);
    return {
      ...summary,
      headers: record.headers ?? {},
      groups: record.data?.["proxy-groups"].map((group) => group.name) ?? []
    };
  }
}
