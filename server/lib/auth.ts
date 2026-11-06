import crypto from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "../db/client";
import { admins, adminSessions } from "../db/schema";
import { env } from "../env";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algo, saltHex, keyHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !keyHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

const COOKIE = "lumen_session";
const SESSION_DAYS = 14;
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export async function createSession(res: Response, adminId: number) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db().insert(adminSessions).values({ tokenHash: sha256(token), adminId, expiresAt });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: env.isProd, expires: expiresAt, path: "/" });
}

export async function destroySession(req: Request, res: Response) {
  const token = req.cookies?.[COOKIE];
  if (token) await db().delete(adminSessions).where(eq(adminSessions.tokenHash, sha256(token)));
  res.clearCookie(COOKIE, { path: "/" });
}

export type AdminUser = { id: number; email: string; name: string; role: "owner" | "editor" | "viewer" };

declare module "express-serve-static-core" {
  interface Request {
    admin?: AdminUser;
  }
}

export async function loadAdmin(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (token) {
    const row = await db()
      .select({ id: admins.id, email: admins.email, name: admins.name, role: admins.role })
      .from(adminSessions)
      .innerJoin(admins, eq(admins.id, adminSessions.adminId))
      .where(and(eq(adminSessions.tokenHash, sha256(token)), gt(adminSessions.expiresAt, new Date())))
      .limit(1);
    if (row[0]) req.admin = row[0];
  }
  next();
}

export function requireAdmin(minRole: "viewer" | "editor" | "owner" = "viewer") {
  const rank = { viewer: 0, editor: 1, owner: 2 };
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.admin) return res.status(401).json({ error: "Not signed in" });
    if (rank[req.admin.role] < rank[minRole]) return res.status(403).json({ error: "Insufficient role" });
    // Admin API is same-origin only: require JSON for writes so plain cross-site forms can't post.
    if (!["GET", "HEAD"].includes(req.method) && !req.is("application/json") && req.headers["content-length"] !== "0") {
      return res.status(415).json({ error: "Expected application/json" });
    }
    next();
  };
}

export async function purgeExpiredSessions() {
  await db().delete(adminSessions).where(lt(adminSessions.expiresAt, new Date()));
}

// Signed, short-lived tokens for previewing a prompt or picking an element on a host page.
export function signToken(payload: Record<string, unknown>, ttlSec = 1800) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString("base64url");
  const sig = crypto.createHmac("sha256", env.appSecret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken<T = Record<string, unknown>>(token: string | undefined): T | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", env.appSecret).update(body).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(body, "base64url").toString());
  if (typeof data.exp !== "number" || data.exp < Date.now() / 1000) return null;
  return data as T;
}
