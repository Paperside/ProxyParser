import type { ProxyFetchResult } from "../types";
import { fetchSubscriptionByUrl } from "./fetch-subscription";
import { parseProxyWithString } from "./proxy-content";
import { genGroups } from "./proxy-group";
import { getFullRules } from "./proxy-rules";

export const getPatchedProxy = async (url: string): Promise<ProxyFetchResult> => {
  const response = await fetchSubscriptionByUrl(url);

  if (response.status === "failed" || !response.text) {
    return response;
  }

  const parsed = parseProxyWithString(response.text);

  if (!parsed) {
    return {
      status: "failed",
      errMsg: "Subscription payload could not be parsed as a clash yaml document.",
      lastModified: new Date(),
      headers: response.headers
    };
  }

  const rules = await getFullRules();
  parsed.rules = rules;
  parsed["proxy-groups"] = genGroups(parsed);

  return {
    status: "success",
    data: parsed,
    headers: response.headers,
    lastModified: response.lastModified
  };
};
