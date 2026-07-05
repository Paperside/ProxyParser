import { logger } from "../logging/logger";
import type { RulesetService } from "../../modules/rulesets/ruleset.service";
import type { UpstreamSourceService } from "../../modules/upstream-sources/upstream-source.service";

// 后台调度器（技术方案 §9）：60s tick，读表判定到期任务。
// 单任务失败全隔离；测试模式不启动定时器，用 runTickOnce() 显式驱动。

export interface SchedulerOptions {
  tickIntervalMs?: number;
  maxSourcesPerTick?: number;
  maxRulesetChecksPerTick?: number;
  rulesetCheckIntervalMinutes: number;
}

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  lastTickAt: string | null = null;

  constructor(
    private readonly sourceService: UpstreamSourceService,
    private readonly rulesetService: RulesetService,
    private readonly options: SchedulerOptions
  ) {}

  start() {
    if (process.env.NODE_ENV === "test" || this.timer) {
      return;
    }
    const interval = this.options.tickIntervalMs ?? 60_000;
    this.timer = setInterval(() => {
      void this.runTickOnce();
    }, interval);
    this.timer.unref?.();
    void this.runTickOnce(); // 启动即跑一轮
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runTickOnce() {
    if (this.running) return;
    this.running = true;
    this.lastTickAt = new Date().toISOString();

    try {
      const dueSources = this.sourceService.listDue(this.options.maxSourcesPerTick ?? 5);
      for (const source of dueSources) {
        try {
          await this.sourceService.sync(source.id);
        } catch (error) {
          // sync 内部已落库与记事件；此处仅保证循环不断
          logger.warn({
            event: "scheduler.source.failed",
            sourceId: source.id,
            reason: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const dueRulesets = this.rulesetService.listDueForCheck(
        this.options.rulesetCheckIntervalMinutes,
        this.options.maxRulesetChecksPerTick ?? 5
      );
      for (const catalog of dueRulesets) {
        try {
          await this.rulesetService.checkForUpdates(catalog.id);
        } catch (error) {
          logger.warn({
            event: "scheduler.ruleset.failed",
            catalogId: catalog.id,
            reason: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}
