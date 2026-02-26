const KEYS = {
  bestReturn: "ml-racer-best-return-v1",
  hyperparams: "ml-racer-hyperparams-v1",
  savedRacers: "ml-racer-saved-racers-v1"
};

function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadBestReturn() {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  const raw = storage.getItem(KEYS.bestReturn);
  if (raw === null) {
    return null;
  }

  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function saveBestReturn(value) {
  const storage = getStorage();
  if (!storage || !Number.isFinite(value)) {
    return;
  }

  storage.setItem(KEYS.bestReturn, String(value));
}

export function clearBestReturn() {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.removeItem(KEYS.bestReturn);
}

export function loadHyperparams() {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  const raw = storage.getItem(KEYS.hyperparams);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveHyperparams(hyperparams) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(KEYS.hyperparams, JSON.stringify(hyperparams));
}

export function loadSavedRacers() {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  const raw = storage.getItem(KEYS.savedRacers);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

export function saveSavedRacers(savedRacers) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  const safeList = Array.isArray(savedRacers) ? savedRacers : [];
  storage.setItem(KEYS.savedRacers, JSON.stringify(safeList));
}
