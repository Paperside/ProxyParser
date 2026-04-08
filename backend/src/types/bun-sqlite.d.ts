declare module "bun:sqlite" {
  export interface SQLiteRunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export interface SQLiteQuery<T = unknown> {
    all(...params: unknown[]): T[];
    get(...params: unknown[]): T | null;
    run(...params: unknown[]): SQLiteRunResult;
  }

  export interface DatabaseOptions {
    create?: boolean;
    readonly?: boolean;
    readwrite?: boolean;
    strict?: boolean;
  }

  export class Database {
    constructor(filename?: string, options?: DatabaseOptions);
    exec(sql: string): void;
    query<T = unknown>(sql: string): SQLiteQuery<T>;
    close(): void;
  }
}
