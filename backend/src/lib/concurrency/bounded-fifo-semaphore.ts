export class SemaphoreQueueFullError extends Error {
  constructor() {
    super("semaphore wait queue is full");
  }
}

interface SemaphoreWaiter {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

const abortError = (signal: AbortSignal) =>
  signal.reason instanceof Error ? signal.reason : new Error("semaphore acquire aborted");

// 固定并发 + 有界 FIFO 等待。release 是幂等的，避免异常清理路径重复释放槽位。
export class BoundedFifoSemaphore {
  private active = 0;
  private readonly waiters: SemaphoreWaiter[] = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueued: number
  ) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error("maxConcurrent must be a positive integer");
    }
    if (!Number.isInteger(maxQueued) || maxQueued < 0) {
      throw new Error("maxQueued must be a non-negative integer");
    }
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(abortError(signal));
    }
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve(this.createRelease());
    }
    if (this.waiters.length >= this.maxQueued) {
      return Promise.reject(new SemaphoreQueueFullError());
    }
    return new Promise((resolve, reject) => {
      const waiter: SemaphoreWaiter = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index < 0) return;
          this.waiters.splice(index, 1);
          reject(abortError(signal));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
    });
  }

  get activeCount() {
    return this.active;
  }

  get queuedCount() {
    return this.waiters.length;
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) {
        // 当前槽位直接移交给队首，active 数不发生瞬时变化。
        if (next.signal && next.onAbort) {
          next.signal.removeEventListener("abort", next.onAbort);
        }
        next.resolve(this.createRelease());
      } else {
        this.active -= 1;
      }
    };
  }
}
