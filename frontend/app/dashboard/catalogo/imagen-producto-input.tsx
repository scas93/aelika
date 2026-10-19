"use client";

import { useRef, useState } from "react";
import { ApiError, uploadProductImage } from "@/lib/api";
import Button from "../_components/Button";

const MAX_BYTES = 5 * 1024 * 1024;
const TIPOS = ["image/jpeg", "image/png", "image/webp"];

// Selector de foto: sube el archivo elegido a R2 al instante y avisa la URL resultante al formulario.
export default function ImagenProductoInput({
  token,
  value,
  onChange,
  onRemove,
}: {
  token: string;
  value: string;
  onChange: (url: string) => void;
  onRemove?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!TIPOS.includes(file.type)) return setError("Formato no válido: usa JPG, PNG o WebP");
    if (file.size > MAX_BYTES) return setError("La imagen pesa más de 5 MB");
    setUploading(true);
    setError(null);
    try {
      const { url } = await uploadProductImage(token, file);
      onChange(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo subir la imagen");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
      Foto (opcional)
      <div className="flex items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- mismo criterio que el resto de la app: <img> plano
          <img src={value} alt="Foto del producto" className="h-16 w-16 rounded-lg border border-black/10 object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-black/20 text-xs font-normal text-admin-ink-soft">
            Sin foto
          </div>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? "Subiendo..." : value ? "Cambiar foto" : "Elegir foto"}
          </Button>
          {value && onRemove && !uploading && (
            <Button type="button" variant="secondary" onClick={onRemove}>
              Quitar
            </Button>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFile} />
      </div>
      <span className="text-xs font-normal text-admin-ink-soft">JPG, PNG o WebP, máximo 5 MB.</span>
      {error && <span className="text-xs font-normal text-red-600">{error}</span>}
    </div>
  );
}
