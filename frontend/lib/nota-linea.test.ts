import { describe, it, expect } from "vitest";
import { NOTA_LINEA_MAX, longitudNota, normalizarNotaLinea, recortarNota } from "./nota-linea";

describe("nota por producto (espejo del backend)", () => {
  it.each([
    ["  hola  ", "hola"],
    ["a    b", "a b"],
    ["a\nb", "a b"],
    ["a\r\n\r\nb\t\tc", "a b c"],
    ["   ", ""],
    ["", ""],
  ])("normaliza %j → %j", (entrada, esperado) => {
    expect(normalizarNotaLinea(entrada)).toBe(esperado);
  });

  it("cuenta caracteres, no unidades UTF-16: un emoji es 1", () => {
    expect(longitudNota("😀".repeat(NOTA_LINEA_MAX))).toBe(NOTA_LINEA_MAX);
  });

  it("recortarNota corta a 140 caracteres sin partir emojis", () => {
    expect(longitudNota(recortarNota("a".repeat(200)))).toBe(NOTA_LINEA_MAX);
    const r = recortarNota("😀".repeat(200));
    expect(longitudNota(r)).toBe(NOTA_LINEA_MAX);
    expect([...r].every((c) => c === "😀")).toBe(true);
    expect(recortarNota("corta")).toBe("corta");
  });
});
