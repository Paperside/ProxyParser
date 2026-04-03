import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

import type { SubscriptionConfig } from "./types";

const backendSrcDir = dirname(fileURLToPath(import.meta.url));
const backendRootDir = resolve(backendSrcDir, "..");
const repoRootDir = resolve(backendRootDir, "..");

const CONFIG_CANDIDATES = [
  resolve(backendRootDir, "config.ts"),
  resolve(backendRootDir, "config.js"),
  resolve(repoRootDir, "config.ts"),
  resolve(repoRootDir, "config.js")
];

const isSubscriptionConfig = (value: unknown): value is SubscriptionConfig => {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { name?: unknown }).name === "string" &&
    typeof (value as { url?: unknown }).url === "string"
  );
};

export const loadSubscriptions = async (): Promise<SubscriptionConfig[]> => {
  for (const candidate of CONFIG_CANDIDATES) {
    if (!existsSync(candidate)) {
      continue;
    }

    const imported = await import(pathToFileURL(candidate).href);
    const rawSubscriptions =
      imported.subscriptions ?? imported.default?.subscriptions;

    if (!Array.isArray(rawSubscriptions)) {
      throw new Error(
        `Config file found at ${candidate}, but it does not export a subscriptions array.`
      );
    }

    if (!rawSubscriptions.every(isSubscriptionConfig)) {
      throw new Error(
        `Config file found at ${candidate}, but one or more subscriptions are invalid.`
      );
    }

    return rawSubscriptions;
  }

  throw new Error(
    "No subscription config found. Create backend/config.ts from backend/config.example.ts, or keep using the existing root config.js."
  );
};
