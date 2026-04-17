/**
 * Story 1.6 — oidc-provider storage adapter backed by Postgres.
 *
 * oidc-provider ships with an in-memory adapter that loses everything on
 * restart. For a self-hosted family server that's unacceptable: a restart
 * would force every mobile app and every registered third-party Solid
 * client to re-authorise. We persist the durable record kinds here (Client,
 * InitialAccessToken, RegistrationAccessToken, Grant, ReplayDetection),
 * and let the volatile ones (AccessToken, AuthorizationCode, Interaction,
 * Session) stay in-memory — their TTL is minutes, a fresh login after
 * restart is fine.
 *
 * Schema: single `oidc_payload` table keyed by (id, kind). See migration
 * 008_webid.sql for the DDL.
 */

import { pool } from '../db/connection';

const DURABLE_KINDS = new Set([
  'Client',
  'InitialAccessToken',
  'RegistrationAccessToken',
  'Grant',
  'ReplayDetection',
]);

export class PostgresAdapter {
  public readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  private isDurable(): boolean {
    return DURABLE_KINDS.has(this.name);
  }

  /**
   * Upsert a payload. oidc-provider calls this on every create/update.
   * expires_at is stored so the cleanup task can reap stale rows.
   */
  async upsert(id: string, payload: Record<string, unknown>, expiresIn?: number): Promise<void> {
    if (!this.isDurable()) {
      inMemory.set(this.key(id), { payload, expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined });
      return;
    }
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
    const grantId = (payload as any).grantId ?? null;
    const userCode = (payload as any).userCode ?? null;
    const uid = (payload as any).uid ?? null;
    await pool.query(
      `INSERT INTO oidc_payload (id, kind, payload, grant_id, user_code, uid, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id, kind)
       DO UPDATE SET payload = EXCLUDED.payload,
                     grant_id = EXCLUDED.grant_id,
                     user_code = EXCLUDED.user_code,
                     uid = EXCLUDED.uid,
                     expires_at = EXCLUDED.expires_at`,
      [id, this.name, payload, grantId, userCode, uid, expiresAt],
    );
  }

  async find(id: string): Promise<Record<string, unknown> | undefined> {
    if (!this.isDurable()) {
      const entry = inMemory.get(this.key(id));
      if (!entry) return undefined;
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        inMemory.delete(this.key(id));
        return undefined;
      }
      return entry.payload;
    }
    const res = await pool.query(
      `SELECT payload, consumed_at
         FROM oidc_payload
        WHERE id = $1 AND kind = $2
          AND (expires_at IS NULL OR expires_at > NOW())`,
      [id, this.name],
    );
    if (res.rows.length === 0) return undefined;
    const row = res.rows[0];
    const payload = row.payload as Record<string, unknown>;
    if (row.consumed_at) payload.consumed = new Date(row.consumed_at).getTime();
    return payload;
  }

  async findByUserCode(userCode: string): Promise<Record<string, unknown> | undefined> {
    if (!this.isDurable()) {
      for (const [k, entry] of inMemory.entries()) {
        if (k.startsWith(`${this.name}:`) && (entry.payload as any).userCode === userCode) {
          return entry.payload;
        }
      }
      return undefined;
    }
    const res = await pool.query(
      `SELECT payload FROM oidc_payload
        WHERE kind = $1 AND user_code = $2
          AND (expires_at IS NULL OR expires_at > NOW())
        LIMIT 1`,
      [this.name, userCode],
    );
    return res.rows[0]?.payload;
  }

  async findByUid(uid: string): Promise<Record<string, unknown> | undefined> {
    if (!this.isDurable()) {
      for (const [k, entry] of inMemory.entries()) {
        if (k.startsWith(`${this.name}:`) && (entry.payload as any).uid === uid) {
          return entry.payload;
        }
      }
      return undefined;
    }
    const res = await pool.query(
      `SELECT payload FROM oidc_payload
        WHERE kind = $1 AND uid = $2
          AND (expires_at IS NULL OR expires_at > NOW())
        LIMIT 1`,
      [this.name, uid],
    );
    return res.rows[0]?.payload;
  }

  async consume(id: string): Promise<void> {
    if (!this.isDurable()) {
      const entry = inMemory.get(this.key(id));
      if (entry) (entry.payload as any).consumed = Date.now();
      return;
    }
    await pool.query(
      `UPDATE oidc_payload SET consumed_at = NOW() WHERE id = $1 AND kind = $2`,
      [id, this.name],
    );
  }

  async destroy(id: string): Promise<void> {
    if (!this.isDurable()) {
      inMemory.delete(this.key(id));
      return;
    }
    await pool.query(`DELETE FROM oidc_payload WHERE id = $1 AND kind = $2`, [id, this.name]);
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    if (!this.isDurable()) {
      for (const [k, entry] of Array.from(inMemory.entries())) {
        if ((entry.payload as any).grantId === grantId) inMemory.delete(k);
      }
      return;
    }
    await pool.query(`DELETE FROM oidc_payload WHERE grant_id = $1`, [grantId]);
  }

  private key(id: string): string {
    return `${this.name}:${id}`;
  }
}

interface MemoryEntry {
  payload: Record<string, unknown>;
  expiresAt?: number;
}
const inMemory = new Map<string, MemoryEntry>();

/**
 * Periodic cleanup of expired durable rows. In-memory entries expire
 * lazily on read.
 */
export async function cleanupOidcPayloads(): Promise<number> {
  const res = await pool.query(
    `DELETE FROM oidc_payload WHERE expires_at IS NOT NULL AND expires_at < NOW()`,
  );
  return res.rowCount ?? 0;
}
