// Neon Harbor — save / load. One small JSON blob in localStorage: cash, mission
// progress, health, ammo and where Rook was standing. A save that fails to parse
// (or storage being off) just starts a fresh game; nothing here ever throws.

const SAVE_KEY = 'neon-harbor-save-v1';

export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data.cash !== 'number' || typeof data.missionIndex !== 'number') return null;
    return {
      cash: data.cash,
      missionIndex: data.missionIndex,
      health: typeof data.health === 'number' ? data.health : 100,
      ammo: typeof data.ammo === 'number' ? data.ammo : 12,
      x: typeof data.x === 'number' ? data.x : 0,
      z: typeof data.z === 'number' ? data.z : 0,
      savedAt: data.savedAt || 0,
    };
  } catch {
    return null;
  }
}

export function saveGame(state) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: state.cash,
      missionIndex: state.missionIndex,
      health: state.health,
      ammo: state.ammo,
      x: state.x,
      z: state.z,
      savedAt: Date.now(),
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try { window.localStorage.removeItem(SAVE_KEY); } catch {}
}
