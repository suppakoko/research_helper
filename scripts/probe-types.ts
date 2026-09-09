/**
 * P0-T06 — type-only probe of the Zotero 10 API surface against
 * `zotero-types@4.1.3`.
 *
 * This file is never executed and never bundled. Every function below is
 * exported but uncalled; its only job is to make the TypeScript compiler
 * resolve one API that `docs/01`, `docs/06`, `docs/07` and `docs/09` say this
 * plugin will call, so that a missing or wrong declaration becomes a compile
 * error instead of a runtime surprise in Phase 1 or Phase 3.
 *
 * Read the verdict table in the spike report, not this file, for the answer to
 * `V-6`. Dated 2026-09-10, against `zotero-types@4.1.3`.
 *
 * **`npm run typecheck` does NOT cover this file.** `tsconfig.json`'s `include`
 * is `["src", "test", "typings", "zotero-plugin.config.ts"]` — `scripts/` is
 * not in it, and `tsconfig.json` is owned by `P0-T05`. To re-run the probe
 * after a `zotero-types` bump, from the repository root:
 *
 * ```sh
 * printf '{"extends":"./tsconfig.json","include":["scripts","typings"]}' \
 *   > tsconfig.probe.json
 * npx tsc --noEmit -p tsconfig.probe.json ; rm tsconfig.probe.json
 * ```
 *
 * Exit 0 means every API below still resolves against `zotero-types` plus
 * `typings/zotero-augment.d.ts`. If it exits 0 *without* the augmentation
 * file, upstream has caught up and blocks of that file can be deleted.
 */

/* eslint-disable no-restricted-globals -- this probe exists to name Zotero.* */

// ---------------------------------------------------------------------------
// 1. Items and collections (V-6: "items, collections")
// ---------------------------------------------------------------------------

export async function probeItems(): Promise<void> {
  const one: Zotero.Item | false = await Zotero.Items.getAsync(1);
  const many: Zotero.Item[] = await Zotero.Items.getAsync([1, 2]);
  void one;
  void many;

  // docs/01 §5.2 — constructor takes an item type name or id.
  const item = new Zotero.Item("journalArticle");

  // docs/01 §5.2.1 — prefer fromJSON() over field-by-field setField().
  item.fromJSON({ itemType: "journalArticle", title: "t" });
  item.addToCollection(1);

  // NOT probed, and the reason is recorded in typings/zotero-augment.d.ts,
  // "Known holes" (b): `item.libraryID = 1;` is what docs/01 §5.2's
  // item-creation shape does, but zotero-types@4.1.3 declares
  // Zotero.DataObject.libraryID as `readonly`, so it fails with TS2540 and
  // declaration merging cannot relax a readonly modifier.

  // docs/01 §3.4(d) — Zotero 10 undo/redo, wired into bulk saves.
  const savedID: boolean | number = await item.saveTx({
    undoAction: "undo-action-edit-metadata",
    undoActionArgs: { count: 1 },
  });
  void savedID;

  // docs/06 §3.3 (design decision D-06-2) — the primary full-text API.
  const text: string = await item.attachmentText;
  void text;
}

export async function probeCollections(): Promise<void> {
  const collection = new Zotero.Collection();
  collection.name = "Research Helper";
  // `collection.libraryID = 1;` omitted for the same reason as on Item — see
  // typings/zotero-augment.d.ts, "Known holes" (b). docs/01 §5.4 assigns it.
  await collection.saveTx();

  const one: Zotero.Collection | false = await Zotero.Collections.getAsync(1);
  const many: Zotero.Collection[] = await Zotero.Collections.getAsync([1, 2]);
  void one;
  void many;
}

// ---------------------------------------------------------------------------
// 2. Notifier (V-6: "notifiers")
// ---------------------------------------------------------------------------

export function probeNotifier(): void {
  const id: string = Zotero.Notifier.registerObserver(
    {
      notify: (event, type, ids, extraData) => {
        void event;
        void type;
        void ids;
        void extraData;
      },
    },
    ["item", "collection"],
    "research-helper",
  );
  Zotero.Notifier.unregisterObserver(id);
}

// ---------------------------------------------------------------------------
// 3. Preference panes and preferences (V-6: "preference panes")
// ---------------------------------------------------------------------------

export async function probePreferencePanes(): Promise<void> {
  const paneID: string = await Zotero.PreferencePanes.register({
    pluginID: "research-helper@suppakoko.github.io",
    src: "prefs.xhtml",
    label: "Research Helper",
  });
  Zotero.PreferencePanes.unregister(paneID);
}

export function probePrefs(): void {
  // Note the union return type: every read needs narrowing under `strict`.
  const raw: boolean | string | number | undefined = Zotero.Prefs.get(
    "research-helper.openai.keyPresent",
    true,
  );
  void raw;
  Zotero.Prefs.set("research-helper.openai.keyPresent", true, true);
  const sym: symbol = Zotero.Prefs.registerObserver(
    "research-helper.openai.keyPresent",
    () => undefined,
    true,
  );
  Zotero.Prefs.unregisterObserver(sym);
}

// ---------------------------------------------------------------------------
// 4. Zotero.HTTP (V-6: "Zotero.HTTP"; docs/01 §8.1, docs/07 §7.4)
// ---------------------------------------------------------------------------

export async function probeHttp(): Promise<void> {
  // The exact option set src/core/http/client.ts passes (docs/07 §7.4) plus
  // `anon: true`, which docs/01 §8.1 requires on every literature/LLM call.
  try {
    const xhr: XMLHttpRequest = await Zotero.HTTP.request(
      "GET",
      "https://example.invalid/",
      {
        headers: { Accept: "application/json" },
        responseType: "json",
        timeout: 60_000,
        anon: true,
        successCodes: false,
        noRetryOnThrottle: true,
        errorDelayMax: 0,
        cancellerReceiver: (cancel: () => void) => void cancel,
      },
    );
    void xhr.response;
  } catch (e) {
    // docs/01 §8.1 exception classes, used with `instanceof` by
    // src/core/http/client.ts's status classifier.
    if (e instanceof Zotero.HTTP.UnexpectedStatusException) {
      const status: number = e.status;
      const is4xx: boolean = e.is4xx();
      void status;
      void is4xx;
    } else if (e instanceof Zotero.HTTP.TimeoutException) {
      void e;
    } else if (e instanceof Zotero.HTTP.BrowserOfflineException) {
      void e;
    } else if (e instanceof Zotero.HTTP.SecurityException) {
      void e;
    } else if (e instanceof Zotero.HTTP.CancelledException) {
      void e;
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Plugin-API managers (docs/01 §4.6 deviation 3, docs/08)
// ---------------------------------------------------------------------------

export function probeMenuManager(): void {
  const menuID: string | false = Zotero.MenuManager.registerMenu({
    menuID: "research-helper-collection",
    pluginID: "research-helper@suppakoko.github.io",
    target: "main/library/collection",
    menus: [
      {
        menuType: "menuitem",
        l10nID: "research-helper-menu-search",
        onCommand: () => undefined,
      },
    ],
  });
  if (typeof menuID === "string") {
    Zotero.MenuManager.unregisterMenu(menuID);
  }
}

export function probeItemPaneManager(): void {
  const key: string | false = Zotero.ItemPaneManager.registerSection({
    paneID: "research-helper-summary",
    pluginID: "research-helper@suppakoko.github.io",
    header: { l10nID: "research-helper-section-header", icon: "" },
    sidenav: { l10nID: "research-helper-section-sidenav", icon: "" },
  });
  if (typeof key === "string") {
    Zotero.ItemPaneManager.unregisterSection(key);
  }
}

// ---------------------------------------------------------------------------
// 6. Secret storage (decision D5; docs/09 §1.3, §1.7)
// ---------------------------------------------------------------------------

export async function probeSecretStore(): Promise<void> {
  const encrypted: string = await Zotero.OSKeyStore.encrypt("secret");
  if (Zotero.OSKeyStore.isEncrypted(encrypted)) {
    const plain: string = await Zotero.OSKeyStore.decrypt(encrypted);
    void plain;
  }
  void Zotero.OSKeyStore.available;

  // Services.logins is the store the encrypted value goes into.
  const logins = await Services.logins.searchLoginsAsync({
    origin: "chrome://research-helper",
    httpRealm: "research_helper API Keys (encrypted)",
  });
  void logins;
  await Services.logins.addLoginAsync(
    {} as unknown as nsILoginInfo, // shape owned by nsILoginInfo, not by us
  );
}

// ---------------------------------------------------------------------------
// 7. Full text and retraction checks (docs/06 §3.3, §13.3)
// ---------------------------------------------------------------------------

export async function probeFullText(item: Zotero.Item): Promise<void> {
  const state: number = await Zotero.Fulltext.getIndexedState(item);
  void state;
  // docs/06 §3.3.5 — exact contract of the direct extractor.
  const result: { text: string; extractedPages: number; totalPages: number } =
    await Zotero.PDFWorker.getFullText(item.id, null);
  void result;
}

export function probeRetractions(item: Zotero.Item): void {
  const retracted: boolean = Zotero.Retractions.isRetracted(item);
  void retracted;
}

// ---------------------------------------------------------------------------
// 8. Database and data directory
// ---------------------------------------------------------------------------

export async function probeDatabase(): Promise<void> {
  const rows = await Zotero.DB.executeTransaction(async () => {
    return Zotero.DB.queryAsync("SELECT 1");
  });
  void rows;

  // docs/07 §5 — the plugin owns a second SQLite file, opened through
  // Zotero.DBConnection rather than Zotero.DB.
  const own = new Zotero.DBConnection("research-helper");
  await own.queryAsync("SELECT 1");

  const dir: string = Zotero.DataDirectory.dir;
  void dir;
}

// ---------------------------------------------------------------------------
// 9. Progress reporting (docs/01 §10.2)
// ---------------------------------------------------------------------------

export function probeProgressWindow(): void {
  const pw = new Zotero.ProgressWindow({ closeOnClick: false });
  pw.changeHeadline("Research Helper");
  pw.show();
  pw.startCloseTimer(5000);
}

// ---------------------------------------------------------------------------
// 10. Zotero 10 selection getters (docs/01 §3.4(a))
//
// The singular getters THROW on Zotero 10. Only the plural forms are probed;
// `docs/01` §12 gotcha 3 forbids modelling the singular ones.
// ---------------------------------------------------------------------------

export function probeSelection(): void {
  const pane = Zotero.getActiveZoteroPane();
  if (!pane) return;
  const collections: Zotero.Collection[] = pane.getSelectedCollections();
  const rows: Zotero.CollectionTreeRow[] = pane.getCollectionTreeRows();
  const libraryIDs: number[] = pane.getSelectedLibraryIDs();
  const searches: Zotero.Search[] = pane.getSelectedSavedSearches();
  const items: Zotero.Item[] = pane.getSelectedItems();
  void collections;
  void rows.filter((r) => r.isGroup());
  void libraryIDs;
  void searches;
  void items;
}
