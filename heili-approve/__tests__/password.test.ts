import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/password";
import { sessionCookieName, usesSecureCookies } from "@/lib/password-session";

describe("password hashing", () => {
  it("verifies the right password and refuses a wrong one", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(stored).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same password!")).not.toBe(await hashPassword("same password!"));
  });

  it("refuses malformed or hostile stored values instead of throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$whatever")).toBe(false);
    expect(await verifyPassword("x", "scrypt$99999999$8$1$AAAA$AAAA")).toBe(false);
    expect(await verifyPassword("x", "scrypt$16384$8$1$$")).toBe(false);
  });

  it("explains passwords that cannot be used", () => {
    expect(passwordProblem("short")).toMatch(/almeno 10/);
    expect(passwordProblem(" spazio iniziale")).toMatch(/spazio/);
    expect(passwordProblem("x".repeat(201))).toMatch(/al massimo/);
    expect(passwordProblem("una password valida")).toBeNull();
  });
});

describe("session cookie name (same rule as Auth.js)", () => {
  it("follows AUTH_URL / NEXTAUTH_URL when set", () => {
    expect(usesSecureCookies({ NEXTAUTH_URL: "https://approve.example" }, "http")).toBe(true);
    expect(usesSecureCookies({ AUTH_URL: "http://localhost:3000" }, "https")).toBe(false);
  });

  it("falls back to the forwarded protocol, https by default", () => {
    expect(usesSecureCookies({}, "http")).toBe(false);
    expect(usesSecureCookies({}, null)).toBe(true);
    expect(sessionCookieName(true)).toBe("__Secure-authjs.session-token");
    expect(sessionCookieName(false)).toBe("authjs.session-token");
  });
});
