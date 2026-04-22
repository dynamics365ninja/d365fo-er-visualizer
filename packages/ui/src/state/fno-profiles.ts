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
    return JSON.parse(raw) as FnoConnection[];
  } catch {
    return [];
  }
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
