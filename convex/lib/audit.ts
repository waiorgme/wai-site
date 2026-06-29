import type { MutationCtx } from "../_generated/server";

// §8 Mandatory audit. Every member-affecting write calls this. AuditLog is
// append-only; rows are never updated or deleted.

type AuditEntry = {
  actor: string;
  role: string;
  action: string;
  target_id: string;
  before_summary?: string;
  after_summary?: string;
  request_id?: string;
  source: "member" | "admin_fallback" | "agent" | "system";
};

export const writeAudit = async (
  ctx: MutationCtx,
  entry: AuditEntry,
): Promise<void> => {
  await ctx.db.insert("auditLog", { ...entry, timestamp: Date.now() });
};
