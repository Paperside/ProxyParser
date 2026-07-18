import { readFileSync } from "node:fs";
import { freemem, loadavg } from "node:os";

const readCgroupNumber = (path: string): number | null => {
  try {
    const value = readFileSync(path, "utf8").trim();
    if (value === "max") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * A deliberately small, content-free snapshot for correlating render,
 * validation, publication and delivery phases with memory pressure.
 */
export const observeResources = () => {
  const memory = process.memoryUsage();
  return {
    processRssBytes: memory.rss,
    processHeapUsedBytes: memory.heapUsed,
    processExternalBytes: memory.external,
    systemFreeMemoryBytes: freemem(),
    systemLoad1m: loadavg()[0] ?? null,
    cgroupMemoryCurrentBytes: readCgroupNumber("/sys/fs/cgroup/memory.current"),
    cgroupMemoryPeakBytes: readCgroupNumber("/sys/fs/cgroup/memory.peak"),
    cgroupSwapCurrentBytes: readCgroupNumber("/sys/fs/cgroup/memory.swap.current")
  };
};
