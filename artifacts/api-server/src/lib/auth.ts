import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

export type Role = "CUSTOMER" | "ORGANISER" | "ADMIN";
export type AuthUser = { id: string; name: string; email: string; role: Role };
export type AuthRequest = Request & { user?: AuthUser };

const secret = () => process.env.JWT_SECRET || process.env.SESSION_SECRET || "development-only-secret";

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function issueToken(user: AuthUser) {
  return jwt.sign(user, secret(), { expiresIn: "7d" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    (req as AuthRequest).user = jwt.verify(header.slice(7), secret()) as AuthUser;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthRequest).user;
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json({ error: "You do not have permission for this action" });
      return;
    }
    next();
  };
}
