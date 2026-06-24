import { sign, verify } from "hono/jwt";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";
import bcrypt from "bcryptjs";
import { prisma } from "./db.js";
import { loadEnv } from "./env.js";

const SESSION_COOKIE = "testui_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 7;

interface SessionPayload {
  userId: string;
  username: string;
  exp: number;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(
  userId: string,
  username: string,
): Promise<string> {
  const env = loadEnv();
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  return sign({ userId, username, exp }, env.TESTUI_SESSION_SECRET, "HS256");
}

async function parseSessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const env = loadEnv();
    const payload = (await verify(
      token,
      env.TESTUI_SESSION_SECRET,
      "HS256",
    )) as SessionPayload;
    if (!payload?.userId || !payload?.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

function isProduction(c: Context): boolean {
  const url = new URL(c.req.url);
  return url.protocol === "https:";
}

export async function getSessionUser(c: Context) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;

  const payload = await parseSessionToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, username: true, createdAt: true },
  });

  return user;
}

export async function requireAuth(c: Context) {
  const user = await getSessionUser(c);
  if (!user) return null;
  return user;
}

export async function registerUser(username: string, password: string) {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    throw new Error("Username already taken");
  }

  const passwordHash = await hashPassword(password);
  return prisma.user.create({
    data: { username, passwordHash },
    select: { id: true, username: true, createdAt: true },
  });
}

export async function loginUser(username: string, password: string) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    throw new Error("Invalid username or password");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw new Error("Invalid username or password");
  }

  return { id: user.id, username: user.username, createdAt: user.createdAt };
}
