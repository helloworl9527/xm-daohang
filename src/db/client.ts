import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";

let delegate: Pool | undefined;

function getDelegate(): Pool {
  if (delegate) return delegate;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  delegate = new Pool({ connectionString: databaseUrl });
  return delegate;
}

const unloadedPool = new Pool();
export const pool: Pool = new Proxy(unloadedPool, {
  get(target, property) {
    if (property === "query" || property === "connect") {
      return (...args: unknown[]) => {
        try {
          const activePool = getDelegate();
          const method = Reflect.get(activePool, property, activePool) as (...values: unknown[]) => unknown;
          return Reflect.apply(method, activePool, args);
        } catch (error) {
          const callback = property === "query" ? args.at(-1) : args[0];
          if (typeof callback === "function") {
            queueMicrotask(() => Reflect.apply(callback, undefined, [error]));
            return;
          }
          return Promise.reject(error);
        }
      };
    }
    if (property === "end" && !delegate) {
      return (callback?: () => void) => {
        if (callback) {
          queueMicrotask(callback);
          return;
        }
        return Promise.resolve();
      };
    }
    const source = delegate ?? target;
    const value = Reflect.get(source, property, source);
    return typeof value === "function" ? value.bind(source) : value;
  },
});
export const db = drizzle(pool, { schema });
