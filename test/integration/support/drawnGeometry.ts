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
