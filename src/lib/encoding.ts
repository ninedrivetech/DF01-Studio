import {
  TextDecoder as LegacyTextDecoder,
  TextEncoder as LegacyTextEncoder,
} from "@kayahr/text-encoding/no-encodings";
import "@kayahr/text-encoding/encodings/gbk";
import "@kayahr/text-encoding/encodings/gb18030";
import "@kayahr/text-encoding/encodings/utf-16le";
import "@kayahr/text-encoding/encodings/utf-16be";

export const BYTE_ENCODINGS = [
  { value: "hex", label: "HEX" },
  { value: "utf-8", label: "UTF-8" },
  { value: "gbk", label: "GBK" },
  { value: "gb18030", label: "GB18030" },
  { value: "ascii", label: "ASCII" },
  { value: "utf-16le", label: "UTF-16LE" },
  { value: "utf-16be", label: "UTF-16BE" },
  { value: "base64", label: "Base64" },
] as const;

export type ByteEncoding = (typeof BYTE_ENCODINGS)[number]["value"];

function encodingLabel(encoding: ByteEncoding) {
  return BYTE_ENCODINGS.find((entry) => entry.value === encoding)!.label;
}

function assertBytes(data: readonly number[]) {
  for (const byte of data) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error("数据必须由 0 至 255 的整数字节组成");
    }
  }
}

export function formatHex(data: readonly number[]): string {
  assertBytes(data);
  return data
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

function assertUnicode(input: string) {
  // Encoders replace lone UTF-16 surrogates unless they are rejected first.
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(++index);
      if (next >= 0xdc00 && next <= 0xdfff) continue;
      throw new Error("文本包含不完整的 Unicode 字符，请检查粘贴内容");
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error("文本包含不完整的 Unicode 字符，请检查粘贴内容");
    }
  }
}

export function decodeBytes(
  data: readonly number[],
  encoding: ByteEncoding,
): string {
  assertBytes(data);
  if (encoding === "hex") return formatHex(data);
  if (encoding === "base64") return btoa(String.fromCharCode(...data));
  if (encoding === "ascii") {
    if (data.some((byte) => byte > 0x7f)) {
      throw new Error("包含超出 ASCII 范围（00-7F）的字节");
    }
    return String.fromCharCode(...data);
  }
  try {
    return new LegacyTextDecoder(encoding, {
      fatal: true,
      ignoreBOM: true,
    }).decode(Uint8Array.from(data));
  } catch {
    throw new Error(
      `字节不是有效的 ${encodingLabel(encoding)} 数据，请选择其他编码`,
    );
  }
}

export function encodeBytes(input: string, encoding: ByteEncoding): number[] {
  if (encoding === "hex") {
    const compact = input.replace(/\s/g, "");
    if (!/^[\da-f]*$/i.test(compact) || compact.length % 2 !== 0) {
      throw new Error("HEX 必须为完整的两位十六进制字节，可用空格分隔");
    }
    return Array.from({ length: compact.length / 2 }, (_, index) =>
      Number.parseInt(compact.slice(index * 2, index * 2 + 2), 16),
    );
  }
  if (encoding === "base64") {
    const compact = input.replace(/\s/g, "");
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        compact,
      )
    ) {
      throw new Error("Base64 格式无效，请检查字符和末尾的 = 填充");
    }
    const decoded = atob(compact);
    if (btoa(decoded) !== compact) {
      throw new Error("Base64 填充位无效，请使用标准 Base64 数据");
    }
    return Array.from(decoded, (char) => char.charCodeAt(0));
  }

  assertUnicode(input);
  if (encoding === "ascii") {
    if (Array.from(input).some((char) => char.codePointAt(0)! > 0x7f)) {
      throw new Error("ASCII 无法编码该文本，请选择 UTF-8、GBK 或 GB18030");
    }
    return Array.from(input, (char) => char.charCodeAt(0));
  }
  try {
    const encoded = Array.from(new LegacyTextEncoder(encoding).encode(input));
    if (decodeBytes(encoded, encoding) !== input) throw new Error("round-trip");
    return encoded;
  } catch {
    throw new Error(
      `${encodingLabel(encoding)} 无法无损编码该文本，请选择其他编码`,
    );
  }
}

export interface EncodedBlock {
  bytes: number[];
  payloadLength: number;
  paddingLength: number;
}

export function encodeBlock(
  input: string,
  encoding: ByteEncoding,
): EncodedBlock {
  const payload = encodeBytes(input, encoding);
  if (payload.length > 16) {
    throw new Error(
      `编码后为 ${payload.length} 字节，超过单块 16 字节，请缩短内容`,
    );
  }
  return {
    bytes: [...payload, ...Array<number>(16 - payload.length).fill(0)],
    payloadLength: payload.length,
    paddingLength: 16 - payload.length,
  };
}

export function visibleText(input: string): string {
  return input.replace(
    /[\\\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g,
    (char) => {
      const escapes: Record<string, string> = {
        "\\": "\\\\",
        "\0": "\\0",
        "\n": "\\n",
        "\r": "\\r",
        "\t": "\\t",
      };
      return (
        escapes[char] ??
        `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
      );
    },
  );
}
