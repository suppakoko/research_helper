/**
 * `plan/09` `P6-T12` — WAV assembly in `src/tts/audioStore.ts`, layer 1:
 * plain Node with a fake file system, no Zotero. The first unit test of this
 * file; `P0-T26`'s own checks live in
 * `test/integration/zotero/attachments.spec.ts`.
 */

import { describe, expect, it } from "vitest";

import { TTSError } from "../../../src/core/errors";
import type { Logger } from "../../../src/core/logger";
import {
  CHUNK_SILENCE_MS,
  GEMINI_PCM_FORMAT,
  WAV_CONTENT_TYPE,
  WAV_HEADER_BYTES,
  concatPcm,
  createAudioStore,
  pcmToWav,
  silencePcm,
  wavHeader,
  type AttachmentApi,
  type AudioFileSystem,
  type PcmChunk,
} from "../../../src/tts/audioStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** `n` bytes of a recognisable, non-zero pattern starting at `seed`. */
function pattern(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = ((seed + i * 7) % 255) + 1;
  return out;
}

function chunk(pcm: Uint8Array, sampleRateHz = 24000): PcmChunk {
  return { pcm, sampleRateHz };
}

interface FakeFiles extends AudioFileSystem {
  readonly disk: Map<string, Uint8Array>;
  readonly calls: string[];
  readonly largestWrite: () => number;
}

function fakeFiles(options: { append?: boolean } = {}): FakeFiles {
  const disk = new Map<string, Uint8Array>();
  const calls: string[] = [];
  let largest = 0;
  const note = (bytes: Uint8Array): void => {
    largest = Math.max(largest, bytes.byteLength);
  };
  const files: FakeFiles = {
    disk,
    calls,
    largestWrite: () => largest,
    join: (...segments) => segments.join("/"),
    makeDirectory: (path) => {
      calls.push(`mkdir ${path}`);
      return Promise.resolve();
    },
    writeFile: (path, bytes) => {
      calls.push(`write ${path} ${bytes.byteLength}`);
      note(bytes);
      disk.set(path, bytes.slice());
      return Promise.resolve(bytes.byteLength);
    },
    exists: (path) => Promise.resolve(disk.has(path)),
  };
  if (options.append !== false) {
    return {
      ...files,
      appendFile: (path, bytes) => {
        calls.push(`append ${path} ${bytes.byteLength}`);
        note(bytes);
        const before = disk.get(path);
        if (before === undefined) {
          return Promise.reject(new Error("append to a missing file"));
        }
        const after = new Uint8Array(before.byteLength + bytes.byteLength);
        after.set(before, 0);
        after.set(bytes, before.byteLength);
        disk.set(path, after);
        return Promise.resolve(bytes.byteLength);
      },
    };
  }
  return files;
}

const NO_ATTACHMENTS: AttachmentApi = {
  importFromFile: () => Promise.reject(new Error("not used")),
  linkFromFile: () => Promise.reject(new Error("not used")),
};

function store(files: AudioFileSystem) {
  return createAudioStore({
    dataDirectory: "D:/data",
    files,
    attachments: NO_ATTACHMENTS,
  });
}

function capturingLogger(): Logger & { readonly lines: string[] } {
  const lines: string[] = [];
  const write = (msg: string, ctx?: Record<string, unknown>): void => {
    lines.push(`${msg} ${JSON.stringify(ctx ?? {})}`);
  };
  const logger: Logger & { lines: string[] } = {
    lines,
    child: () => logger,
    error: write,
    warn: write,
    info: write,
    debug: write,
    time: (_msg, fn) => fn(),
  };
  return logger;
}

function u32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset, true);
}
function u16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint16(offset, true);
}
function ascii(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

const SILENCE_BYTES = 12_000;
const LENGTHS = [4_800, 9_602, 2_000] as const;

// ---------------------------------------------------------------------------
// silencePcm
// ---------------------------------------------------------------------------

describe("silencePcm (P6-T12 step 1)", () => {
  it("is 12,000 zero bytes for 250 ms at 24 kHz", () => {
    const silence = silencePcm(CHUNK_SILENCE_MS, GEMINI_PCM_FORMAT);
    expect(CHUNK_SILENCE_MS).toBe(250);
    expect(silence.byteLength).toBe(SILENCE_BYTES);
    expect(silence.every((b) => b === 0)).toBe(true);
  });

  it("defaults to Gemini's format", () => {
    expect(silencePcm(250).byteLength).toBe(SILENCE_BYTES);
  });

  it("rounds to whole samples, so its length is always even for 16-bit mono", () => {
    for (let ms = 0; ms <= 1000; ms += 0.37) {
      for (const rate of [8000, 11025, 22050, 24000, 44100]) {
        const bytes = silencePcm(ms, {
          ...GEMINI_PCM_FORMAT,
          sampleRateHz: rate,
        });
        expect(bytes.byteLength % 2).toBe(0);
        expect(bytes.byteLength).toBe(Math.round((ms * rate) / 1000) * 2);
      }
    }
  });

  it("is a whole number of frames for stereo too", () => {
    const stereo = { sampleRateHz: 24000, channels: 2, bitsPerSample: 16 };
    expect(silencePcm(250, stereo).byteLength).toBe(24_000);
  });

  it("refuses a negative or non-finite length and a bad format", () => {
    expect(() => silencePcm(-1)).toThrow(RangeError);
    expect(() => silencePcm(Number.NaN)).toThrow(RangeError);
    expect(() =>
      silencePcm(250, { sampleRateHz: 24000, channels: 1, bitsPerSample: 12 }),
    ).toThrow(/invalid PCM format/u);
  });
});

// ---------------------------------------------------------------------------
// wavHeader and pcmToWav
// ---------------------------------------------------------------------------

describe("wavHeader (P6-T12 step 2)", () => {
  it("is the 44-byte canonical header for the given total", () => {
    const header = wavHeader(1000);
    expect(header.byteLength).toBe(WAV_HEADER_BYTES);
    expect(ascii(header, 0)).toBe("RIFF");
    expect(u32(header, 4)).toBe(36 + 1000);
    expect(ascii(header, 8)).toBe("WAVE");
    expect(ascii(header, 12)).toBe("fmt ");
    expect(u32(header, 16)).toBe(16);
    expect(u16(header, 20)).toBe(1);
    expect(u16(header, 22)).toBe(1);
    expect(u32(header, 24)).toBe(24000);
    expect(u32(header, 28)).toBe(48000);
    expect(u16(header, 32)).toBe(2);
    expect(u16(header, 34)).toBe(16);
    expect(ascii(header, 36)).toBe("data");
    expect(u32(header, 40)).toBe(1000);
  });

  it("is exactly the header pcmToWav prepends, which keeps working", () => {
    const pcm = pattern(600, 3);
    const wav = pcmToWav(pcm);
    expect(wav.subarray(0, WAV_HEADER_BYTES)).toEqual(wavHeader(600));
    expect(wav.subarray(WAV_HEADER_BYTES)).toEqual(pcm);
    expect(() =>
      pcmToWav(pcm, { sampleRateHz: 0, channels: 1, bitsPerSample: 16 }),
    ).toThrow(/invalid PCM format/u);
  });

  it("refuses a byte count that is negative, fractional or past 32 bits", () => {
    expect(() => wavHeader(-2)).toThrow(RangeError);
    expect(() => wavHeader(1.5)).toThrow(RangeError);
    expect(() => wavHeader(0xffffffff)).toThrow(/32-bit/u);
    expect(() => wavHeader(0xffffffff - 36)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// concatPcm
// ---------------------------------------------------------------------------

describe("concatPcm", () => {
  it("puts 250 ms of silence between chunks and none after the last", () => {
    const [a, b, c] = LENGTHS.map((n, i) => pattern(n, i * 50));
    if (a === undefined || b === undefined || c === undefined)
      throw new Error();
    const joined = concatPcm([chunk(a), chunk(b), chunk(c)]);
    const total = a.byteLength + b.byteLength + c.byteLength;
    expect(joined.byteLength).toBe(total + 2 * SILENCE_BYTES);
    expect(joined.subarray(0, a.byteLength)).toEqual(a);
    const s1 = a.byteLength;
    expect(joined.subarray(s1, s1 + SILENCE_BYTES).every((x) => x === 0)).toBe(
      true,
    );
    const b0 = s1 + SILENCE_BYTES;
    expect(joined.subarray(b0, b0 + b.byteLength)).toEqual(b);
    const c0 = b0 + b.byteLength + SILENCE_BYTES;
    expect(joined.subarray(c0)).toEqual(c);
  });

  it("adds no silence to a single chunk", () => {
    const only = pattern(480, 9);
    expect(concatPcm([chunk(only)])).toEqual(only);
  });

  it("refuses an empty list", () => {
    expect(() => concatPcm([])).toThrow(RangeError);
  });

  it("refuses a chunk whose rate differs from the file's (docs/04 §6.3)", () => {
    let caught: unknown;
    try {
      concatPcm([chunk(pattern(4, 1)), chunk(pattern(4, 2), 22050)]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TTSError);
    expect((caught as TTSError).context).toMatchObject({
      reason: "sample-rate",
      chunk: 1,
      expected: 24000,
      got: 22050,
    });
  });

  it("checks rates against the format it is given", () => {
    const format = { ...GEMINI_PCM_FORMAT, sampleRateHz: 22050 };
    expect(() => concatPcm([chunk(pattern(4, 1))], { format })).toThrow(
      TTSError,
    );
    expect(
      concatPcm([chunk(pattern(4, 1), 22050)], { format }).byteLength,
    ).toBe(4);
  });

  it("refuses a chunk that is not a whole number of samples", () => {
    expect(() =>
      concatPcm([chunk(pattern(4, 1)), chunk(pattern(5, 2))]),
    ).toThrow(/whole number/u);
  });

  it("strips a WAV handed in by mistake and logs the strip without content", () => {
    const inner = pattern(800, 4);
    const logger = capturingLogger();
    const joined = concatPcm([chunk(pattern(200, 1)), chunk(pcmToWav(inner))], {
      logger,
    });
    expect(joined.byteLength).toBe(200 + SILENCE_BYTES + 800);
    expect(joined.subarray(200 + SILENCE_BYTES)).toEqual(inner);
    expect(logger.lines).toEqual([
      'tts.chunk.wav-header-stripped {"chunk":1,"headerBytes":44}',
    ]);
  });

  it("walks past extra sub-chunks to the data sub-chunk", () => {
    const inner = pattern(16, 8);
    const wav = pcmToWav(inner);
    // Insert a 5-byte "LIST" sub-chunk (odd, so one pad byte) before "data".
    const list = new Uint8Array([
      0x4c, 0x49, 0x53, 0x54, 5, 0, 0, 0, 1, 2, 3, 4, 5, 0,
    ]);
    const odd = new Uint8Array(wav.byteLength + list.byteLength);
    odd.set(wav.subarray(0, 36), 0);
    odd.set(list, 36);
    odd.set(wav.subarray(36), 36 + list.byteLength);
    const logger = capturingLogger();
    expect(concatPcm([chunk(odd)], { logger })).toEqual(inner);
    expect(logger.lines[0]).toContain('"headerBytes":58');
  });

  it("refuses a WAV at another rate or shape, and one with no data", () => {
    const at22k = pcmToWav(pattern(8, 1), {
      ...GEMINI_PCM_FORMAT,
      sampleRateHz: 22050,
    });
    expect(() => concatPcm([chunk(at22k)])).toThrow(/sample rate/u);
    const stereo = pcmToWav(pattern(8, 1), {
      ...GEMINI_PCM_FORMAT,
      channels: 2,
    });
    expect(() => concatPcm([chunk(stereo)])).toThrow(/2-channel/u);
    const headerOnly = wavHeader(0).subarray(0, 36);
    expect(() => concatPcm([chunk(headerOnly)])).toThrow(/no data/u);
    const notWave = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20,
    ]);
    expect(() => concatPcm([chunk(notWave)])).toThrow(/not a WAVE/u);
  });
});

// ---------------------------------------------------------------------------
// writeChunkedWav
// ---------------------------------------------------------------------------

describe("AudioStore.writeChunkedWav (P6-T12 step 3)", () => {
  const chunks = (): PcmChunk[] =>
    LENGTHS.map((n, i) => chunk(pattern(n, i * 50)));

  it("writes 44 + sum(chunks) + 2 × silence bytes with one header that agrees", async () => {
    const files = fakeFiles();
    const input = chunks();
    const written = await store(files).writeChunkedWav({
      stem: "crispr-trends-20261116-en",
      chunks: input,
    });
    const sum = LENGTHS.reduce((a, b) => a + b, 0);
    const expected = WAV_HEADER_BYTES + sum + 2 * SILENCE_BYTES;
    const bytes = files.disk.get(written.path);
    if (bytes === undefined) throw new Error("nothing written");
    expect(bytes.byteLength).toBe(expected);
    expect(written.byteLength).toBe(expected);
    expect(u32(bytes, 4)).toBe(expected - 8);
    expect(u32(bytes, 40)).toBe(expected - WAV_HEADER_BYTES);
    const first = input[0]?.pcm;
    if (first === undefined) throw new Error();
    expect(
      bytes.subarray(WAV_HEADER_BYTES, WAV_HEADER_BYTES + first.byteLength),
    ).toEqual(first);
    // Exactly one "RIFF" and one "data" in the file.
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.split("RIFF")).toHaveLength(2);
    expect(text.split("WAVE")).toHaveLength(2);
    // The samples equal the flat reference join.
    expect(bytes.subarray(WAV_HEADER_BYTES)).toEqual(concatPcm(input));
    expect(written).toMatchObject({
      fileName: "crispr-trends-20261116-en.wav",
      path: "D:/data/research-helper/audio/crispr-trends-20261116-en.wav",
      contentType: WAV_CONTENT_TYPE,
      format: GEMINI_PCM_FORMAT,
    });
  });

  it("writes the header first, then appends chunk, silence, chunk … in order", async () => {
    const files = fakeFiles();
    const written = await store(files).writeChunkedWav({
      stem: "x",
      chunks: chunks(),
    });
    expect(files.calls).toEqual([
      "mkdir D:/data/research-helper/audio",
      `write ${written.path} 44`,
      `append ${written.path} ${LENGTHS[0]}`,
      `append ${written.path} ${SILENCE_BYTES}`,
      `append ${written.path} ${LENGTHS[1]}`,
      `append ${written.path} ${SILENCE_BYTES}`,
      `append ${written.path} ${LENGTHS[2]}`,
    ]);
    // Peak single write is one chunk or the silence, never the whole file.
    expect(files.largestWrite()).toBe(Math.max(...LENGTHS, SILENCE_BYTES));
    expect(files.largestWrite()).toBeLessThan(written.byteLength);
  });

  it("builds one flat buffer when the file system cannot append", async () => {
    const files = fakeFiles({ append: false });
    const input = chunks();
    const written = await store(files).writeChunkedWav({
      stem: "x",
      chunks: input,
    });
    expect(files.calls).toEqual([
      "mkdir D:/data/research-helper/audio",
      `write ${written.path} ${written.byteLength}`,
    ]);
    const bytes = files.disk.get(written.path);
    expect(bytes).toEqual(
      new Uint8Array([
        ...wavHeader(written.byteLength - 44),
        ...concatPcm(input),
      ]),
    );
  });

  it("writes into another folder when asked (P6-T13's linked folder)", async () => {
    const files = fakeFiles();
    const written = await store(files).writeChunkedWav({
      stem: "x",
      chunks: chunks(),
      directory: "E:/Audio",
    });
    expect(written.path).toBe("E:/Audio/x.wav");
    expect(files.calls[0]).toBe("mkdir E:/Audio");
    await expect(
      store(files).writeChunkedWav({
        stem: "x",
        chunks: chunks(),
        directory: " ",
      }),
    ).rejects.toThrow(RangeError);
  });

  it("sanitises the stem", async () => {
    const files = fakeFiles();
    const written = await store(files).writeChunkedWav({
      stem: "a/b:c",
      chunks: chunks(),
    });
    expect(written.fileName).toBe("abc.wav");
  });

  it("checks every chunk before writing anything", async () => {
    const files = fakeFiles();
    await expect(
      store(files).writeChunkedWav({
        stem: "x",
        chunks: [...chunks(), chunk(pattern(4, 1), 16000)],
      }),
    ).rejects.toThrow(TTSError);
    expect(files.calls).toEqual([]);
  });

  it("strips a stray WAV header inside a chunk and still writes one header", async () => {
    const files = fakeFiles();
    const logger = capturingLogger();
    const inner = pattern(400, 2);
    const written = await store(files).writeChunkedWav({
      stem: "x",
      chunks: [chunk(pattern(200, 1)), chunk(pcmToWav(inner))],
      logger,
    });
    expect(written.byteLength).toBe(44 + 200 + SILENCE_BYTES + 400);
    const bytes = files.disk.get(written.path);
    if (bytes === undefined) throw new Error();
    expect(Buffer.from(bytes).toString("latin1").split("RIFF")).toHaveLength(2);
    expect(logger.lines).toHaveLength(1);
  });
});
