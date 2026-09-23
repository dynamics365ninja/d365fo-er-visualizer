/**
 * Persistent store of F&O connection profiles (tenant + envUrl + clientId).
 * Profiles contain no secrets. Refresh tokens live in the Electron safeStorage
 * (main process) or browser MSAL sessionStorage.
 */

import { create } from 'zustand';
import type { FnoConnection } from '@er-visualizer/fno-client';

const STORAGE_KEY = 'er-visualizer.fnoProfiles.v1';

function loadProfiles(): FnoConnection[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return sanitizeProfiles(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * Keep the persisted profiles the connect panel can work with: a non-array
 * value yields `[]`, entries without a string `id` and `envUrl` are dropped,
 * and optional fields of the wrong type are removed.
 */
export function sanitizeProfiles(value: unknown): FnoConnection[] {
  if (!Array.isArray(value)) return [];
  const profiles: FnoConnection[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.id !== 'string' || !entry.id) continue;
    if (typeof entry.envUrl !== 'string' || !entry.envUrl) continue;
    const profile: FnoConnection = {
      id: entry.id,
      displayName: typeof entry.displayName === 'string' ? entry.displayName : entry.envUrl,
      envUrl: entry.envUrl,
      createdAt: isFiniteNumber(entry.createdAt) ? entry.createdAt : 0,
    };
    if (typeof entry.tenantId === 'string') profile.tenantId = entry.tenantId;
    if (typeof entry.clientId === 'string') profile.clientId = entry.clientId;
    if (isFiniteNumber(entry.lastUsedAt)) profile.lastUsedAt = entry.lastUsedAt;
    if (Array.isArray(entry.extraRoots)) {
      profile.extraRoots = entry.extraRoots.filter((root): root is string => typeof root === 'string');
    }
    profiles.push(profile);
  }
  return profiles;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function saveProfiles(profiles: FnoConnection[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // ignore quota
  }
}

export interface FnoProfileStore {
  profiles: FnoConnection[];
  upsert: (profile: FnoConnection) => void;
  remove: (id: string) => void;
  markUsed: (id: string) => void;
}

export const useFnoProfiles = create<FnoProfileStore>((set, get) => ({
  profiles: loadProfiles(),
  upsert: (profile) => {
    const current = get().profiles;
    const idx = current.findIndex(p => p.id === profile.id);
    const next = idx >= 0
      ? current.map(p => (p.id === profile.id ? { ...p, ...profile } : p))
      : [...current, profile];
    saveProfiles(next);
    set({ profiles: next });
  },
  remove: (id) => {
    const next = get().profiles.filter(p => p.id !== id);
    saveProfiles(next);
    set({ profiles: next });
  },
  markUsed: (id) => {
    const next = get().profiles.map(p => p.id === id ? { ...p, lastUsedAt: Date.now() } : p);
    saveProfiles(next);
    set({ profiles: next });
  },
}));

export function newProfileId(): string {
  return `fno-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
