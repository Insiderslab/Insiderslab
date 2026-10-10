/** Discovery documents: OAuth protected-resource metadata (RFC 9728) and /.well-known/mcp.json. */

import { MCP_SCOPES, MCP_SERVER_NAME, type McpConfig } from "./config";

export function protectedResourceDocument(config: McpConfig) {
  if (!config.oauth) return null;
  return {
    resource: config.resource,
    authorization_servers: [config.oauth.issuer.replace(/\/$/, "")],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: MCP_SERVER_NAME,
  };
}

export function mcpManifest(config: McpConfig) {
  return {
    name: MCP_SERVER_NAME,
    description:
      "Legge post, piani e feedback dei clienti dell'agenzia e prepara bozze. Non approva, non invia al cliente, non programma e non pubblica.",
    transport: { type: "streamable-http", url: config.resource },
    authentication: config.oauth
      ? {
          type: "oauth2-bearer",
          oauth: true,
          resource: config.resource,
          scopes: [...MCP_SCOPES],
          protected_resource_metadata: `${config.baseUrl}/.well-known/oauth-protected-resource/mcp`,
          alternative: "Chiave personale «approve_auto_…» come Authorization: Bearer",
        }
      : {
          type: "bearer",
          oauth: false,
          description:
            "OAuth non è configurato su questa installazione: usa una chiave personale «approve_auto_…» (Impostazioni → Importa con Codex o Claude) come Authorization: Bearer.",
        },
    capabilities: { tools: true, prompts: false, resources: false, writes: "drafts-only" },
  };
}
