import type { Database } from 'sql.js';
import type { ChainId } from '../types/chains.js';
import { saveDatabase } from './db.js';

export interface TrackerEntry {
  chain: ChainId;
  contractAddress: string;
  addedAt: number;
}

export function initTrackerStore(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS trackers (
      chain TEXT NOT NULL,
      contract_address TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (chain, contract_address)
    )
  `);
}

export function getTrackers(db: Database): TrackerEntry[] {
  const stmt = db.prepare('SELECT * FROM trackers ORDER BY added_at DESC');
  const results: TrackerEntry[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    results.push({
      chain: row.chain as ChainId,
      contractAddress: row.contract_address as string,
      addedAt: row.added_at as number,
    });
  }
  stmt.free();
  return results;
}

export function addTracker(db: Database, chain: ChainId, contractAddress: string): void {
  db.run('INSERT OR IGNORE INTO trackers (chain, contract_address, added_at) VALUES (?, ?, ?)', [
    chain,
    contractAddress.toLowerCase(),
    Date.now(),
  ]);
  saveDatabase();
}

export function removeTracker(db: Database, chain: ChainId, contractAddress: string): void {
  db.run('DELETE FROM trackers WHERE chain = ? AND contract_address = ?', [
    chain,
    contractAddress.toLowerCase(),
  ]);
  saveDatabase();
}
