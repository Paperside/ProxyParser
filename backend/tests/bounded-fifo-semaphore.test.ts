import { describe, expect, test } from "bun:test";

import {
  BoundedFifoSemaphore,
  SemaphoreQueueFullError
} from "../src/lib/concurrency/bounded-fifo-semaphore";

describe("BoundedFifoSemaphore", () => {
  test("最多两个并发，等待者按 FIFO 获得释放的槽位", async () => {
    const semaphore = new BoundedFifoSemaphore(2, 8);
    const releaseFirst = await semaphore.acquire();
    const releaseSecond = await semaphore.acquire();
    const order: number[] = [];

    const third = semaphore.acquire().then((release) => {
      order.push(3);
      return release;
    });
    const fourth = semaphore.acquire().then((release) => {
      order.push(4);
      return release;
    });

    expect(semaphore.activeCount).toBe(2);
    expect(semaphore.queuedCount).toBe(2);
    releaseSecond();
    const releaseThird = await third;
    expect(order).toEqual([3]);
    expect(semaphore.activeCount).toBe(2);
    expect(semaphore.queuedCount).toBe(1);

    releaseFirst();
    const releaseFourth = await fourth;
    expect(order).toEqual([3, 4]);
    releaseThird();
    releaseThird(); // release 幂等，不得误释放 fourth 的槽位
    expect(semaphore.activeCount).toBe(1);
    releaseFourth();
    expect(semaphore.activeCount).toBe(0);
  });

  test("等待队列有界，只有超出容量的请求被拒绝", async () => {
    const semaphore = new BoundedFifoSemaphore(2, 1);
    const releaseFirst = await semaphore.acquire();
    const releaseSecond = await semaphore.acquire();
    const queued = semaphore.acquire();

    await expect(semaphore.acquire()).rejects.toBeInstanceOf(SemaphoreQueueFullError);
    releaseFirst();
    const releaseQueued = await queued;
    releaseSecond();
    releaseQueued();
    expect(semaphore.activeCount).toBe(0);
  });

  test("等待中的请求取消后立即退出队列且不占用后续槽位", async () => {
    const semaphore = new BoundedFifoSemaphore(1, 2);
    const releaseFirst = await semaphore.acquire();
    const controller = new AbortController();
    const cancelled = semaphore.acquire(controller.signal);
    const next = semaphore.acquire();

    expect(semaphore.queuedCount).toBe(2);
    controller.abort();
    await expect(cancelled).rejects.toHaveProperty("name", "AbortError");
    expect(semaphore.queuedCount).toBe(1);

    releaseFirst();
    const releaseNext = await next;
    expect(semaphore.activeCount).toBe(1);
    releaseNext();
    expect(semaphore.activeCount).toBe(0);
  });
});
