import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import { Secret } from "../../../src/prefs/secrets";

/**
 * `P3-T01`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network.
 *
 * `docs/09` §2.1 level 1: "Template-interpolating a `Secret` yields
 * `[Secret]`. `JSON.stringify` on any object containing one yields
 * `"[Secret]"`. The only leak path is an explicit `.expose()`."
 *
 * The key is synthetic and built at run time, so no key-shaped literal sits in
 * this file.
 */

/** An Anthropic-shaped synthetic key: prefix plus thirty filler characters. */
const raw = (): string => "sk-ant-" + "x".repeat(30);

describe("Secret (docs/09 §2.1, P3-T01)", () => {
  it("returns the value from expose(), and only from expose()", () => {
    expect(new Secret(raw()).expose()).toBe(raw());
  });

  it('serializes as "[Secret]" inside JSON.stringify, with no key material', () => {
    const json = JSON.stringify({ k: new Secret(raw()) });
    expect(json).toBe('{"k":"[Secret]"}');
    expect(json).not.toContain("sk-ant-");
    expect(json).not.toContain("x".repeat(30));
  });

  it("yields [Secret] when template-interpolated", () => {
    const secret = new Secret(raw());
    expect(`${secret}`).toBe("[Secret]");
  });

  it("yields [Secret] from String() and from string concatenation", () => {
    const secret = new Secret(raw());
    expect(String(secret)).toBe("[Secret]");
    expect("key=" + (secret as unknown as string)).toBe("key=[Secret]");
  });

  it("yields [Secret] from Node's util.inspect, which console.log uses", () => {
    const secret = new Secret(raw());
    expect(inspect(secret)).toBe("[Secret]");
    expect(inspect({ k: secret })).not.toContain("sk-ant-");
  });

  it("reports the Secret tag to Object.prototype.toString", () => {
    expect(Object.prototype.toString.call(new Secret(raw()))).toBe(
      "[object Secret]",
    );
  });

  it("exposes no own key, so spread and Object.entries carry nothing", () => {
    const secret = new Secret(raw());
    expect(Object.keys(secret)).toEqual([]);
    expect(Reflect.ownKeys(secret)).toEqual([]);
    expect(JSON.stringify({ ...secret })).toBe("{}");
  });

  it("has no valueOf of its own, so a primitive conversion falls to toString", () => {
    // `docs/09` §2.1 / P3-T01 Do NOT: no getter, no spread-friendly shape, no
    // valueOf. Object.prototype.valueOf returns the object, not the key.
    const secret = new Secret(raw());
    expect(Object.hasOwn(Secret.prototype, "valueOf")).toBe(false);
    expect(secret.valueOf()).toBe(secret);
  });

  it("keeps expose() the only reader: every other prototype member hides the key", () => {
    const secret = new Secret(raw());
    const proto = Secret.prototype as unknown as Record<PropertyKey, unknown>;
    for (const name of Reflect.ownKeys(Secret.prototype)) {
      if (name === "constructor" || name === "expose") continue;
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      const out =
        descriptor?.get !== undefined
          ? descriptor.get.call(secret)
          : (descriptor?.value as (this: Secret) => unknown).call(secret);
      expect(String(out)).not.toContain("x".repeat(30));
    }
  });
});
