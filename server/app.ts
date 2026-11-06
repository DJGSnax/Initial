import express, { type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { loadAdmin } from "./lib/auth";
import { adminRouter, eraseVisitor, visitorData } from "./routes/admin";
import { publicRouter } from "./routes/public";
import { isValidVisitorId } from "./lib/privacy";
import { env } from "./env";

export async function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: false, // set per-route below; the embed script must load cross-origin
      crossOriginResourcePolicy: { policy: "cross-origin" },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  // Beacons arrive as text/plain to avoid CORS preflights.
  app.use("/api/public/events", express.text({ type: "text/plain", limit: "256kb" }), (req, _res, next) => {
    if (typeof req.body === "string") {
      try {
        req.body = JSON.parse(req.body);
      } catch {
        req.body = {};
      }
    }
    next();
  });
  app.use(cookieParser());

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  app.use("/api/public", publicRouter);
  app.use("/api/admin", loadAdmin, adminRouter);

  // Privacy automation API for erasure/access requests from your other systems.
  const privacyAuth = (req: Request, res: Response, next: NextFunction) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const expected = env.privacyApiToken ?? "";
    if (!expected || token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!isValidVisitorId(req.params.vid)) return res.status(400).json({ error: "Invalid visitor id" });
    next();
  };
  app.get("/api/privacy/visitors/:vid", privacyAuth, async (req, res) => res.json(await visitorData(String(req.params.vid))));
  app.delete("/api/privacy/visitors/:vid", privacyAuth, async (req, res) => res.json(await eraseVisitor(String(req.params.vid))));

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  // Embed snippet bundle
  const embedDir = path.resolve("dist/embed");
  app.get("/embed/kb.js", (_req, res) => {
    const file = path.join(embedDir, "kb.js");
    if (!fs.existsSync(file)) return res.status(503).type("text/plain").send("// embed not built yet: run npm run build:embed");
    res.setHeader("Cache-Control", env.isProd ? "public, max-age=300" : "no-cache");
    res.type("application/javascript").sendFile(file);
  });

  // Demo host page for trying the snippet locally
  app.get(["/demo", "/demo/*splat"], (_req, res) => {
    res.type("html").send(fs.readFileSync(path.resolve("scripts/demo.html"), "utf8").replaceAll("%BASE%", env.publicUrl));
  });

  app.get("/", (_req, res) => res.redirect("/help"));

  if (env.isProd) {
    const clientDir = path.resolve("dist/client");
    app.use(express.static(clientDir, { index: false, maxAge: "1h" }));
    app.get("/*splat", (_req, res) => res.sendFile(path.join(clientDir, "index.html")));
  } else if (!env.isTest) {
    const { createServer } = await import("vite");
    const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  }

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Something went wrong" });
  });

  return app;
}
