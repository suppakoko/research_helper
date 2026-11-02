import { describe, expect, it } from "vitest";

import {
  L10N_MENU_ITEM_FIND_RELATED,
  L10N_MENU_ROOT,
} from "../../../src/i18n/keys";
import {
  itemMenuOptions,
  type ItemMenuCommands,
} from "../../../src/ui/menus/registerMenus";

/**
 * `P5-T15` — the item context menu's rules, without Zotero (`docs/13` §2.1).
 *
 * The same `MenuManager` data the real menu is built from, driven with a
 * context of this file's making. Whether Zotero honours it (one real item, two
 * real items, a disable/enable cycle) is `test/integration/menus.spec.ts`'s.
 *
 * **This file is not in `P5-T15`'s `Files` list, and that is reported with the
 * card.** `plan/08` §0.2 item 24 asks for a mutation sweep with every card that
 * adds logic, and a sweep needs tests that run without the real application.
 */

interface FakeItem {
  readonly id: number;
  isRegularItem(): boolean;
}

const regular = (id: number): FakeItem => ({ id, isRegularItem: () => true });
const note = (id: number): FakeItem => ({ id, isRegularItem: () => false });

interface Entry {
  readonly menuType: string;
  readonly l10nID?: string;
  readonly menus?: readonly Entry[];
  onShowing?(event: unknown, context: unknown): void;
  onCommand?(event: unknown, context: unknown): void;
}

function menu(overrides: Partial<ItemMenuCommands> = {}) {
  const opened: { host: unknown; seedItemID: number }[] = [];
  const errors: string[] = [];
  const commands: ItemMenuCommands = {
    relatedEnabled: () => true,
    openRelatedWindow: (host, seedItemID) => {
      opened.push({ host, seedItemID });
      return undefined;
    },
    onError: (message) => {
      errors.push(message);
    },
    ...overrides,
  };
  const options = itemMenuOptions(commands);
  const [submenu] = options.menus as unknown as readonly Entry[];
  const [entry] = submenu?.menus ?? [];
  if (!submenu || !entry) throw new Error("no item menu built");
  return { options, submenu, entry, opened, errors };
}

/**
 * A context that fails the test on a read of `collectionTreeRow`: the platform's
 * getter throws for more than one selected row (`docs/08` §2.2), so a read of it
 * has to be caught here and not by a user with two rows selected. The handlers
 * catch what they call, so the read is recorded as well as thrown.
 */
function context(
  items: readonly FakeItem[] | undefined,
  host: unknown = { openDialog: () => null },
) {
  const probe: {
    visible?: boolean;
    enabled?: boolean;
    l10nArgs?: unknown;
    readSingular?: boolean;
  } = {};
  const built: Record<string, unknown> = {
    menuElem: { ownerDocument: { defaultView: host } },
    setVisible: (visible: boolean) => {
      probe.visible = visible;
    },
    setEnabled: (enabled: boolean) => {
      probe.enabled = enabled;
    },
    setL10nArgs: (args: string) => {
      probe.l10nArgs = JSON.parse(args);
    },
    get collectionTreeRow(): never {
      probe.readSingular = true;
      throw new Error("collectionTreeRow was read");
    },
  };
  if (items !== undefined) built["items"] = items;
  return { built, probe };
}

function visibility(
  items: readonly FakeItem[] | undefined,
  overrides: Partial<ItemMenuCommands> = {},
) {
  const { submenu, errors } = menu(overrides);
  const { built, probe } = context(items);
  submenu.onShowing?.({}, built);
  expect(errors).toEqual([]);
  expect(probe.readSingular).toBeUndefined();
  return probe.visible;
}

function enabled(items: readonly FakeItem[] | undefined) {
  const { entry, errors } = menu();
  const { built, probe } = context(items);
  entry.onShowing?.({}, built);
  expect(errors).toEqual([]);
  expect(probe.readSingular).toBeUndefined();
  return probe.enabled;
}

describe("P5-T15 — the item menu's shape", () => {
  it("is one submenu on main/library/item holding one entry", () => {
    const { options, submenu, entry } = menu();
    expect(options.target).toBe("main/library/item");
    expect(options.menus).toHaveLength(1);
    expect(submenu.menuType).toBe("submenu");
    expect(submenu.l10nID).toBe(L10N_MENU_ROOT);
    expect(submenu.menus).toHaveLength(1);
    expect(entry.menuType).toBe("menuitem");
    expect(entry.l10nID).toBe(L10N_MENU_ITEM_FIND_RELATED);
  });
});

describe("P5-T15 — the submenu's visibility", () => {
  it("shows for one regular item and for two", () => {
    expect(visibility([regular(1)])).toBe(true);
    expect(visibility([regular(1), regular(2)])).toBe(true);
  });

  it("hides when the selection has no regular item", () => {
    expect(visibility([])).toBe(false);
    expect(visibility([note(1)])).toBe(false);
    expect(visibility(undefined)).toBe(false);
  });

  it("hides while related.enabled is false, and reads it every time", () => {
    expect(visibility([regular(1)], { relatedEnabled: () => false })).toBe(
      false,
    );
    let on = false;
    const { submenu } = menu({ relatedEnabled: () => on });
    const first = context([regular(1)]);
    submenu.onShowing?.({}, first.built);
    expect(first.probe.visible).toBe(false);
    on = true;
    const second = context([regular(1)]);
    submenu.onShowing?.({}, second.built);
    expect(second.probe.visible).toBe(true);
  });

  it("reports a failed check through onError rather than throwing", () => {
    const { submenu, errors } = menu({
      relatedEnabled: () => {
        throw new Error("no preference");
      },
    });
    expect(() => {
      submenu.onShowing?.({}, context([regular(1)]).built);
    }).not.toThrow();
    expect(errors).toHaveLength(1);
  });
});

describe("P5-T15 — the entry, disabled unless exactly one regular item (item 321(b))", () => {
  it("is enabled for one regular item", () => {
    expect(enabled([regular(1)])).toBe(true);
  });

  it("is disabled for two, and for none", () => {
    expect(enabled([regular(1), regular(2)])).toBe(false);
    expect(enabled([])).toBe(false);
    expect(enabled(undefined)).toBe(false);
  });

  it("asks for the disabled reason exactly when it is disabled", () => {
    const argsFor = (items: readonly FakeItem[]) => {
      const { entry } = menu();
      const { built, probe } = context(items);
      entry.onShowing?.({}, built);
      return probe.l10nArgs;
    };
    expect(argsFor([regular(1)])).toEqual({ oneItem: "yes" });
    expect(argsFor([regular(1), note(2)])).toEqual({ oneItem: "yes" });
    expect(argsFor([regular(1), regular(2)])).toEqual({ oneItem: "no" });
  });

  it("counts regular items only: one item and its note is one seed", () => {
    expect(enabled([regular(1), note(2)])).toBe(true);
    expect(enabled([note(1), note(2)])).toBe(false);
  });

  it("reports a failed check through onError rather than throwing", () => {
    const { entry, errors } = menu();
    const items = [
      {
        id: 1,
        isRegularItem: () => {
          throw new Error("no item");
        },
      },
    ];
    expect(() => {
      entry.onShowing?.({}, context(items).built);
    }).not.toThrow();
    expect(errors).toHaveLength(1);
  });
});

describe("P5-T15 — the entry's command", () => {
  it("opens on the one regular item, from the window that owns the element", () => {
    const { entry, opened, errors } = menu();
    const host = { name: "main", openDialog: () => null };
    const { built, probe } = context([regular(41)], host);
    entry.onCommand?.({}, built);
    expect(errors).toEqual([]);
    expect(opened).toEqual([{ host, seedItemID: 41 }]);
    expect(opened[0]?.host).toBe(host);
    expect(probe.readSingular).toBeUndefined();
  });

  it("takes the regular item as the seed when a note is selected with it", () => {
    const { entry, opened } = menu();
    entry.onCommand?.({}, context([note(9), regular(41)]).built);
    expect(opened.map((call) => call.seedItemID)).toEqual([41]);
  });

  it("refuses and reports when the selection is no longer one regular item", () => {
    for (const items of [[], [note(1)], [regular(1), regular(2)], undefined]) {
      const { entry, opened, errors } = menu();
      entry.onCommand?.({}, context(items).built);
      expect(opened).toEqual([]);
      expect(errors).toHaveLength(1);
    }
  });

  it("refuses and reports when the element has no window", () => {
    const { entry, opened, errors } = menu();
    entry.onCommand?.({}, context([regular(1)], null).built);
    expect(opened).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it("reports a failed opener rather than throwing", () => {
    const { entry, errors } = menu({
      openRelatedWindow: () => {
        throw new Error("no window");
      },
    });
    expect(() => {
      entry.onCommand?.({}, context([regular(1)]).built);
    }).not.toThrow();
    expect(errors).toHaveLength(1);
  });

  it("reports an opener's rejection rather than leaving it unhandled", async () => {
    const { entry, errors } = menu({
      openRelatedWindow: () => Promise.reject(new Error("no window")),
    });
    entry.onCommand?.({}, context([regular(1)]).built);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toHaveLength(1);
  });
});
