/**
 * Typed database query helpers for mints, watchlist, and config history.
 */

import type { Database } from 'sql.js';
import { saveDatabase } from './db.js';
import type { ChainId } from '../types/chains.js';
import type { WatchlistEntry } from '../types/strategy.js';

/** A mint record as stored in the database */
export interface MintRecord {
  id: number;
  chain: string;
  contract_address: string;
  wallet_address: string;
  tx_hash: string | null;
  token_id: string | null;
  mint_price: string;
  gas_cost: string | null;
  status: 'pending' | 'confirmed' | 'failed';
  error_reason: string | null;
  created_at: number;
  confirmed_at: number | null;
}

// ─── Mint Records ────────────────────────────────────────

/** Insert a new mint record and return the row ID */
export function insertMint(
  db: Database,
  record: Omit<MintRecord, 'id'>
): number {
  db.run(
    `INSERT INTO mints (chain, contract_address, wallet_address, tx_hash, token_id, mint_price, gas_cost, status, error_reason, created_at, confirmed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.chain,
      record.contract_address,
      record.wallet_address,
      record.tx_hash,
      record.token_id,
      record.mint_price,
      record.gas_cost,
      record.status,
      record.error_reason,
      record.created_at,
      record.confirmed_at,
    ]
  );
  saveDatabase();

  // Get last insert ID
  const result = db.exec('SELECT last_insert_rowid() as id');
  return (result[0]?.values[0]?.[0] as number) ?? 0;
}

/** Update mint status after confirmation or failure */
export function updateMintStatus(
  db: Database,
  id: number,
  status: string,
  txHash?: string,
  gasCost?: string,
  tokenId?: string
): void {
  db.run(
    `UPDATE mints SET status = ?, tx_hash = COALESCE(?, tx_hash), gas_cost = COALESCE(?, gas_cost), 
     token_id = COALESCE(?, token_id), confirmed_at = ? WHERE id = ?`,
    [status, txHash ?? null, gasCost ?? null, tokenId ?? null, Math.floor(Date.now() / 1000), id]
  );
  saveDatabase();
}

/** Get paginated recent mints */
export function getRecentMints(db: Database, limit = 10, offset = 0): MintRecord[] {
  const stmt = db.prepare(
    'SELECT * FROM mints ORDER BY created_at DESC LIMIT ? OFFSET ?'
  );
  stmt.bind([limit, offset]);

  const results: MintRecord[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as MintRecord);
  }
  stmt.free();
  return results;
}

/** Get total count of mint records */
export function getMintCount(db: Database): number {
  const result = db.exec('SELECT COUNT(*) as count FROM mints');
  return (result[0]?.values[0]?.[0] as number) ?? 0;
}

/** Count mints in the last hour */
export function getMintsInLastHour(db: Database): number {
  const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
  const result = db.exec(
    `SELECT COUNT(*) as count FROM mints WHERE created_at > ${oneHourAgo}`
  );
  return (result[0]?.values[0]?.[0] as number) ?? 0;
}

// ─── Watchlist ───────────────────────────────────────────

/** Get all watchlist entries */
export function getWatchlist(db: Database): WatchlistEntry[] {
  const stmt = db.prepare('SELECT * FROM watchlist ORDER BY added_at DESC');
  const results: WatchlistEntry[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as { chain: string; contract_address: string; name: string; added_at: number };
    results.push({
      chain: row.chain as ChainId,
      contractAddress: row.contract_address,
      name: row.name,
      addedAt: row.added_at,
    });
  }
  stmt.free();
  return results;
}

/** Add a contract to the watchlist */
export function addToWatchlist(
  db: Database,
  entry: { chain: string; contractAddress: string; name: string }
): void {
  db.run(
    'INSERT OR IGNORE INTO watchlist (chain, contract_address, name, added_at) VALUES (?, ?, ?, ?)',
    [entry.chain, entry.contractAddress, entry.name, Math.floor(Date.now() / 1000)]
  );
  saveDatabase();
}

/** Remove a contract from the watchlist */
export function removeFromWatchlist(
  db: Database,
  chain: string,
  contractAddress: string
): void {
  db.run('DELETE FROM watchlist WHERE chain = ? AND contract_address = ?', [
    chain,
    contractAddress,
  ]);
  saveDatabase();
}

/** Check if a contract is in the watchlist */
export function isInWatchlist(
  db: Database,
  chain: string,
  contractAddress: string
): boolean {
  const result = db.exec(
    `SELECT COUNT(*) as count FROM watchlist WHERE chain = '${chain}' AND contract_address = '${contractAddress}'`
  );
  return ((result[0]?.values[0]?.[0] as number) ?? 0) > 0;
}

// ─── Config History ──────────────────────────────────────

/** Log a configuration change */
export function logConfigChange(
  db: Database,
  key: string,
  oldValue: string,
  newValue: string
): void {
  db.run(
    'INSERT INTO config_history (key, old_value, new_value, changed_at) VALUES (?, ?, ?, ?)',
    [key, oldValue, newValue, Math.floor(Date.now() / 1000)]
  );
  saveDatabase();
}

// ─── RPC Management ──────────────────────────────────────

export interface RpcRecord {
  id: number;
  chain: string;
  url: string;
  is_active: boolean;
  added_at: number;
}

export function getRpcs(db: Database, chain: string): RpcRecord[] {
  const stmt = db.prepare('SELECT * FROM rpcs WHERE chain = ? ORDER BY id ASC');
  stmt.bind([chain]);
  const results: RpcRecord[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as Omit<RpcRecord, 'is_active'> & { is_active: number };
    results.push({ ...row, is_active: row.is_active === 1 });
  }
  stmt.free();
  return results;
}

export function getActiveRpc(db: Database, chain: string): RpcRecord | null {
  const stmt = db.prepare('SELECT * FROM rpcs WHERE chain = ? AND is_active = 1 LIMIT 1');
  stmt.bind([chain]);
  let result: RpcRecord | null = null;
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as Omit<RpcRecord, 'is_active'> & { is_active: number };
    result = { ...row, is_active: true };
  }
  stmt.free();
  return result;
}

export function addRpc(db: Database, chain: string, url: string, is_active: boolean = false): void {
  // If this is the first RPC for the chain, or if explicitly requested, make it active
  const existing = getRpcs(db, chain);
  if (existing.length === 0) {
    is_active = true;
  }
  
  if (is_active) {
    db.run('UPDATE rpcs SET is_active = 0 WHERE chain = ?', [chain]);
  }
  
  db.run(
    'INSERT INTO rpcs (chain, url, is_active, added_at) VALUES (?, ?, ?, ?)',
    [chain, url, is_active ? 1 : 0, Math.floor(Date.now() / 1000)]
  );
  saveDatabase();
}

export function setActiveRpc(db: Database, chain: string, id: number): void {
  db.run('UPDATE rpcs SET is_active = 0 WHERE chain = ?', [chain]);
  db.run('UPDATE rpcs SET is_active = 1 WHERE chain = ? AND id = ?', [chain, id]);
  saveDatabase();
}
