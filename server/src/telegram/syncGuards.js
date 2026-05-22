import { ActionGuard } from "./actionGuard.js";

/** Shared guard for manual, scheduled, and quiet sync entry points. */
export const syncRunGuard = new ActionGuard({ cooldownSec: 35 });

export const SYNC_ACTION_KEY = "sync";
