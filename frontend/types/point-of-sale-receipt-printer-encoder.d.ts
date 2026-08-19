// No official types are shipped with this package — minimal ambient
// declaration covering only the chainable methods this project actually
// uses (see documentation at https://github.com/NielsLeenheer/ReceiptPrinterEncoder).
declare module "@point-of-sale/receipt-printer-encoder" {
  interface ReceiptPrinterEncoderOptions {
    language?: "esc-pos" | "star-prnt" | "star-line";
    columns?: number;
  }

  export default class ReceiptPrinterEncoder {
    constructor(options?: ReceiptPrinterEncoderOptions);
    initialize(): this;
    align(direction: "left" | "center" | "right"): this;
    bold(state?: boolean): this;
    invert(state?: boolean): this;
    size(width: number, height?: number): this;
    line(text: string): this;
    newline(count?: number): this;
    rule(): this;
    cut(type?: "partial" | "full"): this;
    encode(): Uint8Array<ArrayBuffer>;
  }
}
