import { vi } from "vitest";

/**
 * The minimal `Zotero` fake of docs/13 §2.1, installed as a global by
 * `vitest.config.ts`'s `test.setupFiles`.
 *
 * **It is deliberately small, and it must stay small.** docs/13 §2.1: "if a test
 * needs a richer Zotero, that is a signal the code belongs in an integration
 * test instead", and "a fake that lies is worse than no fake". Extending this
 * file to make a unit test pass is the failure mode it is written against.
 *
 * Most unit tests should never touch it. docs/07 §2.3 forbids `Zotero.*` outside
 * `src/zotero/`, everything that genuinely needs the platform goes through that
 * facade (mocked wholesale), and `core/` takes ports — `PrefStore`, `Clock`,
 * `HttpClient` — from the container instead. This exists for the small number of
 * tests that still want the global to be *defined*.
 *
 * > **Unverified** (docs/13 §2.1's own marker, carried here verbatim in intent):
 * > the exact signatures of `Zotero.DB.executeTransaction` and of `Zotero.Item`
 * > construction on Zotero 10. Spike `V-12` reconciles them against
 * > `zotero-types` and against observed behaviour (`P0-T20`); until then these
 * > two shapes are the least trustworthy things in this file.
 */
class FakeItem {
  private _fields = new Map<string, string>();
  // docs/13 §2.1 declares `static nextId` *after* the `id` initializer that
  // reads it. That is fine at runtime — statics initialize at class-definition
  // time, instance fields at construction — but TypeScript rejects it as
  // TS2729, "Property 'nextId' is used before its initialization". The order is
  // swapped here; nothing else about the fake changed. Recorded as a docs/13
  // §2.1 defect for the P0-T28 spike report.
  static nextId = 1;
  public id = FakeItem.nextId++;
  constructor(public itemType: string) {}
  setField(f: string, v: string) {
    this._fields.set(f, v);
  }
  getField(f: string) {
    return this._fields.get(f) ?? "";
  }
  setCreators(_c: unknown[]) {
    /* recorded via spy */
  }
  addTag(_t: string) {}
  async saveTx() {
    return this.id;
  }
}

const Zotero = {
  debug: vi.fn(),
  logError: vi.fn(),
  Prefs: (() => {
    const store = new Map<string, unknown>();
    return {
      get: vi.fn((k: string) => store.get(k)),
      set: vi.fn((k: string, v: unknown) => void store.set(k, v)),
      clear: vi.fn((k: string) => void store.delete(k)),
      __store: store,
    };
  })(),
  Items: { getAsync: vi.fn(), get: vi.fn() },
  Collections: { getAsync: vi.fn() },
  Item: FakeItem,
  DB: {
    executeTransaction: vi.fn(async (fn: () => Promise<void>) => fn()),
  },
  HTTP: { request: vi.fn() },
  getMainWindow: vi.fn(() => undefined),
  locale: "en-US",
};

vi.stubGlobal("Zotero", Zotero);
export { Zotero as FakeZotero };
