import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";

import { loadSubscriptions } from "./config";
import { ProxyStore } from "./services/proxy-store";

const main = async () => {
  const subscriptions = await loadSubscriptions();
  const store = new ProxyStore(subscriptions);

  await store.prime();

  const port = Number(process.env.PORT ?? 3001);

  const app = new Elysia()
    .use(
      cors({
        origin: true
      })
    )
    .use(
      swagger({
        documentation: {
          info: {
            title: "ProxyParser API",
            version: "1.0.0"
          }
        }
      })
    )
    .get("/", () => ({
      name: "ProxyParser backend",
      status: "ok",
      docs: "/swagger",
      endpoints: {
        health: "/api/health",
        status: "/api/proxy/status",
        rules: "/api/proxy/rules",
        refreshAll: "/api/proxy/refresh",
        proxyMeta: "/api/proxy/:name/meta",
        proxyConfig: "/api/proxy/:name"
      }
    }))
    .get("/api/health", () => ({
      status: "ok",
      time: new Date().toISOString()
    }))
    .get("/api/proxy", async () => {
      return store.list();
    })
    .get("/api/proxy/status", async () => {
      return store.list();
    })
    .get("/api/proxy/rules", async () => {
      return store.getRules();
    })
    .post("/api/proxy/refresh", async () => {
      return store.refreshAll();
    })
    .get("/api/proxy/:name/meta", async ({ params, set }) => {
      const meta = await store.getMeta(params.name);

      if (!meta) {
        set.status = 404;
        return {
          message: `No such proxy name: ${params.name}`
        };
      }

      return meta;
    })
    .post("/api/proxy/:name/refresh", async ({ params, set }) => {
      const record = await store.refreshOne(params.name);

      if (!record) {
        set.status = 404;
        return {
          message: `No such proxy name: ${params.name}`
        };
      }

      if (record.status === "failed") {
        set.status = 503;
      }

      return store.getMeta(params.name);
    })
    .get("/api/proxy/:name", async ({ params, set }) => {
      const record = await store.getOrRefresh(params.name);

      if (!record) {
        set.status = 404;
        return {
          message: `No such proxy name: ${params.name}`
        };
      }

      if (record.status === "failed" || !record.data) {
        set.status = 503;
        return {
          message: `Proxy ${params.name} is currently unavailable.`,
          error: record.errMsg ?? null
        };
      }

      set.headers = {
        ...(record.headers ?? {}),
        "content-type": "application/json; charset=utf-8"
      };

      return record.data;
    })
    .listen(port);

  console.log(`backend running on http://localhost:${app.server?.port ?? port}`);
};

main().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});
