const UINT32_MAX = 0x100000000;

export function normalizeSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) {
    const normalized = Math.abs(Math.floor(seed)) >>> 0;
    return normalized || 1;
  }

  if (typeof seed === "string") {
    const trimmed = seed.trim();
    if (!trimmed) {
      return 1;
    }

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const normalized = Math.abs(Math.floor(numeric)) >>> 0;
      return normalized || 1;
    }

    let hash = 2166136261;
    for (let i = 0; i < trimmed.length; i += 1) {
      hash ^= trimmed.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) || 1;
  }

  return 1;
}

export function randomSeed() {
  return ((Math.random() * UINT32_MAX) >>> 0) || 1;
}

export class RNG {
  constructor(seed = 1) {
    this.state = normalizeSeed(seed);
  }

  next() {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / UINT32_MAX;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }

  int(min, max) {
    const low = Math.ceil(min);
    const high = Math.floor(max);
    if (high <= low) {
      return low;
    }
    return low + Math.floor(this.next() * (high - low + 1));
  }

  pick(items) {
    if (!items.length) {
      return undefined;
    }
    return items[this.int(0, items.length - 1)];
  }

  clone() {
    const copy = new RNG(1);
    copy.state = this.state;
    return copy;
  }
}
