import { describe, it, expect } from "vitest";
import { linkTarjeta } from "./lealtad-pase";

describe("linkTarjeta", () => {
  it("devuelve el link si es una URL https válida", () => {
    expect(linkTarjeta({ shareUrl: "https://pass.walletwallet.dev/p/abc" })).toBe("https://pass.walletwallet.dev/p/abc");
  });

  it.each([null, undefined, {}, { shareUrl: undefined }, { shareUrl: null }, { shareUrl: "" }, { shareUrl: "  " }])(
    "sin link (%j) devuelve null",
    (pase) => {
      expect(linkTarjeta(pase as never)).toBeNull();
    },
  );

  it("rechaza lo que no es una URL http(s)", () => {
    expect(linkTarjeta({ shareUrl: "undefined" })).toBeNull();
    expect(linkTarjeta({ shareUrl: "javascript:alert(1)" })).toBeNull();
    expect(linkTarjeta({ shareUrl: "/p/abc" })).toBeNull();
  });
});
