export class Float32RingBuffer {
  private readonly storage: Float32Array;
  private readIndex = 0;
  private writeIndex = 0;
  private availableSamples = 0;

  constructor(size: number) {
    this.storage = new Float32Array(size);
  }

  availableRead(): number {
    return this.availableSamples;
  }

  availableWrite(): number {
    return this.storage.length - this.availableSamples;
  }

  push(source: Float32Array): void {
    if (source.length > this.availableWrite()) {
      throw new Error("AudioWorklet ring buffer overflow.");
    }

    let remaining = source.length;
    let sourceOffset = 0;

    while (remaining > 0) {
      const chunk = Math.min(remaining, this.storage.length - this.writeIndex);
      this.storage.set(source.subarray(sourceOffset, sourceOffset + chunk), this.writeIndex);
      this.writeIndex = (this.writeIndex + chunk) % this.storage.length;
      this.availableSamples += chunk;
      remaining -= chunk;
      sourceOffset += chunk;
    }
  }

  pullInto(target: Float32Array): boolean {
    if (target.length > this.availableSamples) {
      return false;
    }

    let remaining = target.length;
    let targetOffset = 0;

    while (remaining > 0) {
      const chunk = Math.min(remaining, this.storage.length - this.readIndex);
      target.set(this.storage.subarray(this.readIndex, this.readIndex + chunk), targetOffset);
      this.readIndex = (this.readIndex + chunk) % this.storage.length;
      this.availableSamples -= chunk;
      remaining -= chunk;
      targetOffset += chunk;
    }

    return true;
  }

  clear(): void {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.availableSamples = 0;
  }
}
