/**
 * What a real window draws, read from layout and computed style rather than from the
 * `hidden` property (`plan/00` §6 item 355(c), `docs/08` §5.4's note of 2026-11-06).
 *
 * **Why.** A rule of the window's stylesheet that sets `display` beats the platform's
 * own rule for a `hidden` element, so an element can read `hidden` true and still be
 * drawn: `.rh-wrap`'s `flex` did that to both Semantic Scholar key notices, 22 px with
 * their words and link, while every unit test passed because it read the property.
 * The two readings here are the ones that would have caught it.
 */

/** One element's box and computed `display`, and its first link's box. */
export interface DrawnBox {
  readonly hidden: boolean;
  readonly display: string;
  readonly height: number;
  readonly width: number;
  /** How many boxes the element has: zero means it is not drawn at all. */
  readonly boxes: number;
  readonly linkHeight: number;
  readonly linkWidth: number;
  readonly linkBoxes: number;
}

/** Read `element` and the first `a` inside it, as they are drawn now. */
export function drawnBox(win: Window, element: Element): DrawnBox {
  const box = element.getBoundingClientRect();
  const link = element.querySelector("a");
  const linkBox = link?.getBoundingClientRect();
  return {
    hidden: (element as unknown as { hidden?: boolean }).hidden === true,
    display: win.getComputedStyle(element)?.display ?? "",
    height: box.height,
    width: box.width,
    boxes: element.getClientRects().length,
    linkHeight: linkBox?.height ?? 0,
    linkWidth: linkBox?.width ?? 0,
    linkBoxes: link?.getClientRects().length ?? 0,
  };
}

/**
 * Every element of the document that is asked to hide and still has a `display`
 * other than `none`, by its id or its tag and class. Empty when the window draws
 * nothing it was asked to hide.
 */
export function hiddenButDrawn(win: Window): string[] {
  const doc = win.document;
  return (Array.from(doc.querySelectorAll("*")) as Element[])
    .filter(
      (element) =>
        (element as unknown as { hidden?: boolean }).hidden === true &&
        (win.getComputedStyle(element)?.display ?? "none") !== "none",
    )
    .map((element) =>
      element.id === ""
        ? `${element.localName}.${element.getAttribute("class") ?? ""}`
        : `#${element.id}`,
    );
}

/** An element's id, or its tag and class, as {@link hiddenButDrawn} names it. */
function nameOf(element: Element): string {
  return element.id === ""
    ? `${element.localName}.${element.getAttribute("class") ?? ""}`
    : `#${element.id}`;
}

/**
 * Every drawn element under `scroller` with no drawn element inside it that its
 * visible bottom edge cuts through: the top of it shows and the rest does not
 * (`plan/00` §6 item 359(c), 2026-11-06). Empty when the edge falls between lines.
 * The related header's edge cut its four Include checkboxes 2 px below their top,
 * and the recommend header's cut its chips in half, while every property read true.
 */
export function cutAtEdge(scroller: Element): string[] {
  const top = scroller.getBoundingClientRect().top;
  const edge = top + scroller.clientHeight;
  const drawn = (element: Element): boolean => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  return (Array.from(scroller.querySelectorAll("*")) as Element[])
    .filter(
      (element) =>
        drawn(element) &&
        !(Array.from(element.children) as Element[]).some(drawn),
    )
    .filter((element) => {
      const box = element.getBoundingClientRect();
      return box.top < edge - 0.5 && box.bottom > edge + 0.5;
    })
    .map(
      (element) =>
        `${nameOf(element)} ${String(Math.round(element.getBoundingClientRect().top))}-` +
        `${String(Math.round(element.getBoundingClientRect().bottom))} against ${String(Math.round(edge))}`,
    );
}

/**
 * The dialog's own rows that are drawn lower than the top of OK and Cancel, by their
 * boxes (`plan/00` §6 item 359(c)). Empty when nothing runs under the buttons: in the
 * related window's table state the import note ran 557 to 580 against buttons at 559
 * to 586.
 */
export function drawnUnderButtons(dialog: Element): string[] {
  const buttons = dialog as unknown as { getButton(name: string): Element };
  const top = Math.min(
    buttons.getButton("accept").getBoundingClientRect().top,
    buttons.getButton("cancel").getBoundingClientRect().top,
  );
  return (Array.from(dialog.children) as Element[])
    .filter((row) => {
      const box = row.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.bottom > top + 0.5;
    })
    .map(
      (row) =>
        `${nameOf(row)} ends ${String(Math.round(row.getBoundingClientRect().bottom))} against ${String(Math.round(top))}`,
    );
}

/**
 * Each word of the text under `root` that is drawn over more than one line, read from
 * the boxes of its own letters (`plan/00` §6 item 359(c)). Korean was broken between
 * syllables (등장 / 하는) by the platform's default line breaking.
 */
export function wordsBrokenOverLines(root: Element): string[] {
  const doc = root.ownerDocument as Document;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const broken: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    for (const match of text.matchAll(/\S+/gu)) {
      const range = doc.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const tops = new Set(
        (Array.from(range.getClientRects() ?? []) as DOMRect[])
          .filter((box) => box.width > 0)
          .map((box) => Math.round(box.top)),
      );
      if (tops.size > 1) broken.push(match[0]);
    }
  }
  return broken;
}
