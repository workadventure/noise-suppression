// LiteRT's Emscripten glue expects these browser globals during module evaluation.
if (!("self" in globalThis)) {
  Object.defineProperty(globalThis, "self", {
    configurable: true,
    value: globalThis,
  });
}

if (!("location" in globalThis)) {
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: {
      href: "https://audio-worklet.local/audio-worklet-processor.js",
    },
  });
}

if (!("TextDecoder" in globalThis)) {
  class AudioWorkletTextDecoder {
    private readonly encoding: string;

    constructor(label = "utf-8") {
      this.encoding = label.toLowerCase();
    }

    decode(input?: ArrayBuffer | ArrayBufferView): string {
      const bytes = this.toBytes(input);

      if (this.encoding === "utf-16le" || this.encoding === "utf-16") {
        return this.decodeUtf16Le(bytes);
      }

      return this.decodeUtf8(bytes);
    }

    private toBytes(input: ArrayBuffer | ArrayBufferView | undefined): Uint8Array {
      if (input === undefined) {
        return new Uint8Array();
      }

      if (ArrayBuffer.isView(input)) {
        return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      }

      return new Uint8Array(input);
    }

    private decodeUtf16Le(bytes: Uint8Array): string {
      const codeUnits: number[] = [];

      for (let i = 0; i + 1 < bytes.length; i += 2) {
        codeUnits.push(bytes[i]! | (bytes[i + 1]! << 8));
      }

      return String.fromCharCode(...codeUnits);
    }

    private decodeUtf8(bytes: Uint8Array): string {
      const codePoints: number[] = [];

      for (let i = 0; i < bytes.length; ) {
        const first = bytes[i++]!;

        if (first < 0x80) {
          codePoints.push(first);
          continue;
        }

        if ((first & 0xe0) === 0xc0 && i < bytes.length) {
          codePoints.push(((first & 0x1f) << 6) | (bytes[i++]! & 0x3f));
          continue;
        }

        if ((first & 0xf0) === 0xe0 && i + 1 < bytes.length) {
          codePoints.push(
            ((first & 0x0f) << 12) |
              ((bytes[i++]! & 0x3f) << 6) |
              (bytes[i++]! & 0x3f)
          );
          continue;
        }

        if ((first & 0xf8) === 0xf0 && i + 2 < bytes.length) {
          codePoints.push(
            ((first & 0x07) << 18) |
              ((bytes[i++]! & 0x3f) << 12) |
              ((bytes[i++]! & 0x3f) << 6) |
              (bytes[i++]! & 0x3f)
          );
          continue;
        }

        codePoints.push(0xfffd);
      }

      return String.fromCodePoint(...codePoints);
    }
  }

  Object.defineProperty(globalThis, "TextDecoder", {
    configurable: true,
    value: AudioWorkletTextDecoder,
  });
}

if (!("URL" in globalThis)) {
  class AudioWorkletURL {
    readonly href: string;

    constructor(url: string, base?: string) {
      if (base !== undefined && url === ".") {
        const lastSlash = base.lastIndexOf("/");
        this.href = lastSlash >= 0 ? base.slice(0, lastSlash + 1) : base;
        return;
      }

      this.href = url;
    }

    toString(): string {
      return this.href;
    }

    static createObjectURL(): string {
      throw new Error("URL.createObjectURL is not available in AudioWorklet.");
    }

    static revokeObjectURL(): void {}
  }

  Object.defineProperty(globalThis, "URL", {
    configurable: true,
    value: AudioWorkletURL,
  });
}

export {};
