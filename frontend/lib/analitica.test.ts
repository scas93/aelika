import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.fn();
const capture = vi.fn();
const identify = vi.fn();
const reset = vi.fn();
const group = vi.fn();
vi.mock("posthog-js", () => ({
  default: { init, capture, identify, reset, group },
}));

async function cargar() {
  vi.resetModules();
  return import("./analitica");
}

describe("analitica", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("sin token no inicializa ni captura nada", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    const a = await cargar();
    a.capturar("portal_visto", { slug: "x" });
    a.identificarCliente("c1", "x");
    a.reiniciarIdentidad();
    await new Promise((r) => setTimeout(r, 10));
    expect(init).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("con token apaga autocapture/heatmaps y enmascara inputs", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    const a = await cargar();
    a.capturar("portal_visto", { slug: "x" });
    await vi.waitFor(() => expect(capture).toHaveBeenCalled());
    const cfg = init.mock.calls[0][1];
    expect(cfg.autocapture).toBe(false);
    expect(cfg.capture_heatmaps).toBe(false);
    expect(cfg.capture_performance).toBe(false);
    expect(cfg.session_recording.maskAllInputs).toBe(true);
  });

  it("descarta propiedades no permitidas", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    const a = await cargar();
    a.capturar("pedido_confirmado", {
      slug: "x",
      piezas: 3,
      telefono: "5512345678",
      total: 99,
    } as never);
    await vi.waitFor(() => expect(capture).toHaveBeenCalled());
    expect(capture).toHaveBeenCalledWith("pedido_confirmado", {
      slug: "x",
      piezas: 3,
    });
  });

  it("reinicia la identidad al cambiar de cliente", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    const a = await cargar();
    a.identificarCliente("c1", "x");
    await vi.waitFor(() => expect(identify).toHaveBeenCalledTimes(1));
    a.identificarCliente("c2", "x");
    expect(reset).toHaveBeenCalledTimes(1);
    expect(identify).toHaveBeenLastCalledWith("c2", { negocio: "x" });
  });

  it("quita el folio de las URLs", async () => {
    const a = await cargar();
    expect(a.limpiarUrl("https://p/mayoreo/b/portal/pedidos/P-000012/modificar")).toBe(
      "https://p/mayoreo/b/portal/pedidos/:folio/modificar",
    );
  });
});
