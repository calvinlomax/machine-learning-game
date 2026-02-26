export class ReplayBuffer {
  constructor(capacity) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.buffer = new Array(this.capacity);
    this.index = 0;
    this.size = 0;
  }

  push(transition) {
    this.buffer[this.index] = transition;
    this.index = (this.index + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
  }

  sample(batchSize, rng) {
    const count = Math.max(1, Math.floor(batchSize));
    const samples = [];
    for (let i = 0; i < count; i += 1) {
      const item = this.buffer[Math.floor(rng.next() * this.size)];
      if (item) {
        samples.push(item);
      }
    }
    return samples;
  }

  clear() {
    this.buffer = new Array(this.capacity);
    this.index = 0;
    this.size = 0;
  }

  resize(nextCapacity) {
    const capacity = Math.max(1, Math.floor(nextCapacity));
    if (capacity === this.capacity) {
      return;
    }

    const ordered = this.toArray();
    this.capacity = capacity;
    this.buffer = new Array(this.capacity);
    this.index = 0;
    this.size = 0;

    const start = Math.max(0, ordered.length - this.capacity);
    for (let i = start; i < ordered.length; i += 1) {
      this.push(ordered[i]);
    }
  }

  toArray() {
    const ordered = [];
    for (let i = 0; i < this.size; i += 1) {
      const idx = (this.index - this.size + i + this.capacity) % this.capacity;
      const item = this.buffer[idx];
      if (item) {
        ordered.push(item);
      }
    }
    return ordered;
  }
}
