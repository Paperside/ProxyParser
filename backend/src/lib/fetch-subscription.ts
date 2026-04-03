import type { ProxyFetchResult } from "../types";

export const fetchSubscriptionByUrl = async (
  url: string
): Promise<ProxyFetchResult & { text?: string }> => {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "clash-verge/v1.6.6"
      }
    });

    if (!response.ok) {
      throw new Error(`Request failed with ${response.status} ${response.statusText}`);
    }

    return {
      status: "success",
      data: null,
      headers: Object.fromEntries(response.headers.entries()),
      lastModified: new Date(),
      errMsg: undefined,
      text: await response.text()
    };
  } catch (error) {
    return {
      status: "failed",
      errMsg: String(error),
      lastModified: new Date()
    };
  }
};
