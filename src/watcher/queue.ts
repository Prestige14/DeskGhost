export class ConcurrencyQueue {
  private concurrency: number;
  private running = 0;
  private queue: Array<() => Promise<void>> = [];

  constructor(concurrency: number = 2) {
    this.concurrency = concurrency;
  }

  push(task: () => Promise<void>): void {
    this.queue.push(task);
    this.next();
  }

  private next(): void {
    if (this.running >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    this.running++;
    task()
      .catch((err) => {
        console.error('[Queue Error]', err);
      })
      .finally(() => {
        this.running--;
        this.next();
      });
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get runningCount(): number {
    return this.running;
  }
}
