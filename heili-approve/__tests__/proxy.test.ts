import { describe, expect, it } from "vitest";
import { isAllowedAuthPath } from "../proxy";

describe("isAllowedAuthPath (K-13)", () => {
  it("lets the Auth.js routes the app uses through", () => {
    for (const path of [
      "/api/auth/signin",
      "/api/auth/signout",
      "/api/auth/session",
      "/api/auth/csrf",
      "/api/auth/providers",
      "/api/auth/verify-request",
      "/api/auth/error",
      "/api/auth/callback/nodemailer",
      "/api/auth/callback/resend",
    ]) {
      expect(isAllowedAuthPath(path), path).toBe(true);
    }
  });

  it("answers 404 to the paths bots probe", () => {
    for (const path of [
      "/api/auth/login",
      "/api/auth/callback",
      "/api/auth/callback/",
      "/api/auth/signin/extra",
      "/api/auth/wp-admin",
      "/api/auth/token",
    ]) {
      expect(isAllowedAuthPath(path), path).toBe(false);
    }
  });
});
