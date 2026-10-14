import { describe, expect, it } from "vitest";
import { resolveBaseUrl } from "../lib/env";
import { getMcpConfig } from "../lib/mcp/config";

const env = (entries: Record<string, string>) => entries as unknown as NodeJS.ProcessEnv;

describe("resolveBaseUrl", () => {
  it("treats a variable set but empty as unset (the docker-compose slip)", () => {
    expect(resolveBaseUrl(env({ PUBLIC_BASE_URL: "" }))).toBe("http://localhost:3000");
    expect(resolveBaseUrl(env({ PUBLIC_BASE_URL: "   " }))).toBe("http://localhost:3000");
    expect(resolveBaseUrl(env({ PUBLIC_BASE_URL: "", NEXTAUTH_URL: "https://app.example.com" }))).toBe(
      "https://app.example.com"
    );
  });

  it("prefers PUBLIC_BASE_URL and strips the trailing slash", () => {
    expect(
      resolveBaseUrl(env({ PUBLIC_BASE_URL: "https://approve.example.com/", NEXTAUTH_URL: "https://other.example.com" }))
    ).toBe("https://approve.example.com");
  });

  it("refuses a relative value with a clear error", () => {
    expect(() => resolveBaseUrl(env({ PUBLIC_BASE_URL: "/approve" }))).toThrow(/absolute http\(s\) URL/);
  });
});

describe("getMcpConfig with an empty PUBLIC_BASE_URL", () => {
  it("still builds absolute MCP URLs", () => {
    const config = getMcpConfig(env({ PUBLIC_BASE_URL: "" }));
    expect(config.baseUrl).toBe("http://localhost:3000");
    expect(config.resource).toBe("http://localhost:3000/mcp");
  });
});
