import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

// ── Supabase client ───────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── Audit event types ─────────────────────────────────────────────────────────

export type AuditEvent =
  | "MINT_SUCCESS"
  | "MINT_FAILURE"
  | "ACCESS_GRANT_SUCCESS"
  | "ACCESS_GRANT_FAILURE";

// ── Log payload ───────────────────────────────────────────────────────────────

export interface AuditLogPayload {
  event:               AuditEvent;
  user_id:             string;           // UUID from profiles table (signer's profile)
  actor_address:       string;           // wallet address of the signer
  patient_address?:    string;
  doctor_address?:     string;
  token_id?:           number;
  blockchain_txn_hash?: string;          // unique — only set on success
  error_message?:      string;           // only set on failure
  metadata?:           Record<string, unknown>;
}

// ── Serialise all fields into log_content JSON string ────────────────────────
// The table stores everything in a single `log_content` text column.
// Writing structured JSON keeps it human-readable and queryable via
// Supabase's ->> operator e.g: log_content::jsonb->>'event'

function buildLogContent(payload: AuditLogPayload): string {
  return JSON.stringify({
    event:           payload.event,
    actor_address:   payload.actor_address.toLowerCase(),
    patient_address: payload.patient_address?.toLowerCase() ?? null,
    doctor_address:  payload.doctor_address?.toLowerCase()  ?? null,
    token_id:        payload.token_id      ?? null,
    error_message:   payload.error_message ?? null,
    metadata:        payload.metadata      ?? null,
    logged_at:       new Date().toISOString(),
  });
}

// ── Core log function ─────────────────────────────────────────────────────────

/**
 * Inserts one row into public.audit_logs matching this schema:
 *
 *   id                  uuid  PK  default gen_random_uuid()
 *   user_id             uuid  FK → profiles(id)   NOT NULL
 *   log_content         text                       NOT NULL
 *   blockchain_txn_hash text  UNIQUE               NULL
 *   created_at          timestamptz                default now()
 *
 * Never throws — a logging failure must not crash the caller.
 */
export async function writeAuditLog(payload: AuditLogPayload): Promise<void> {
  try {
    const { error } = await supabase.from("audit_logs").insert({
      user_id:             payload.user_id,
      log_content:         buildLogContent(payload),
      // Only pass blockchain_txn_hash when present — column has a UNIQUE constraint
      blockchain_txn_hash: payload.blockchain_txn_hash ?? null,
    });

    if (error) {
      console.error("[AuditLog] Supabase insert error:", error.message);
    } else {
      console.log(`[AuditLog] ${payload.event} logged for user ${payload.user_id}`);
    }
  } catch (err) {
    console.error("[AuditLog] Unexpected error writing audit log:", err);
  }
}