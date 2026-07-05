import { Agent } from "node:https";

/**
 * @returns {{ defaultAgent: import("node:https").Agent; longPollAgent: import("node:https").Agent }}
 */
export function createTelegramHttpAgents() {
  return {
    defaultAgent: new Agent({
      keepAlive: true,
      maxSockets: 16,
      keepAliveMsecs: 30000,
    }),
    longPollAgent: new Agent({
      keepAlive: true,
      maxSockets: 2,
      keepAliveMsecs: 60000,
    }),
  };
}

/**
 * @param {{ defaultAgent?: import("node:https").Agent; longPollAgent?: import("node:https").Agent } | null | undefined} agents
 */
export function destroyTelegramHttpAgents(agents) {
  try {
    agents?.defaultAgent?.destroy();
  } catch {
    // best-effort
  }
  try {
    agents?.longPollAgent?.destroy();
  } catch {
    // best-effort
  }
}
