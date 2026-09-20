import { getSupabaseClient } from '@/lib/supabaseClient';
import { LocalStorageAdapter } from './LocalStorageAdapter';
import { SupabaseAdapter } from './SupabaseAdapter';
import type { StorageAdapter } from './StorageAdapter';

export type { StorageAdapter } from './StorageAdapter';
export { LocalStorageAdapter, MemoryStore } from './LocalStorageAdapter';
export { SupabaseAdapter } from './SupabaseAdapter';

let adapter: StorageAdapter | null = null;

/**
 * Decide o adaptador em UM único lugar:
 *  - .env do Supabase preenchido -> SupabaseAdapter;
 *  - caso contrário             -> LocalStorageAdapter.
 *
 * Nenhuma tela conhece essa decisão.
 */
export function getStorageAdapter(): StorageAdapter {
  if (!adapter) {
    const client = getSupabaseClient();
    adapter = client ? new SupabaseAdapter(client) : new LocalStorageAdapter();
  }
  return adapter;
}

/** Injeção manual — usada nos testes. */
export function setStorageAdapter(next: StorageAdapter | null): void {
  adapter = next;
}
