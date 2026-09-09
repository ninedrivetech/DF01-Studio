import { describe, expect, it } from "vitest";
import {
  BYTE_ENCODINGS,
  decodeBytes,
  encodeBlock,
  encodeBytes,
  formatHex,
  visibleText,
} from "./encoding";

describe("block byte encodings", () => {
  const documented = [0xd3, 0xc5, 0xc1, 0xe9, 0xbf, 0xc6, 0xbc, 0xbc];

  it("decodes and writes the protocol's GBK Chinese example without replacement", () => {
    expect(decodeBytes(documented, "gbk")).toBe("优灵科技");
    expect(encodeBytes("优灵科技", "gbk")).toEqual(documented);
    expect(encodeBlock("优灵科技", "gbk")).toEqual({
      bytes: [...documented, ...Array<number>(8).fill(0)],
      payloadLength: 8,
      paddingLength: 8,
    });
    expect(decodeBytes(documented, "gb18030")).toBe("优灵科技");
  });

  it.each(["utf-8", "gb18030", "utf-16le", "utf-16be"] as const)(
    "round-trips Chinese and supplementary Unicode in %s",
    (encoding) => {
      const text = "中文\u{1f680}";
      expect(decodeBytes(encodeBytes(text, encoding), encoding)).toBe(text);
    },
  );

  it("rejects characters that GBK and ASCII cannot represent", () => {
    expect(() => encodeBytes("\u{1f680}", "gbk")).toThrow("无法无损编码");
    expect(() => encodeBytes("中文", "ascii")).toThrow("无法编码");
    expect(() => decodeBytes([0x80], "ascii")).toThrow("ASCII");
    expect(encodeBytes("?", "gbk")).toEqual([0x3f]);
  });

  it.each([
    "utf-8",
    "gbk",
    "gb18030",
    "ascii",
    "utf-16le",
    "utf-16be",
  ] as const)(
    "rejects lone surrogates before %s can replace them",
    (encoding) => {
      expect(() => encodeBytes("\ud800", encoding)).toThrow("Unicode");
      expect(() => encodeBytes("\udc00", encoding)).toThrow("Unicode");
      expect(() => encodeBytes("\ud800A", encoding)).toThrow("Unicode");
    },
  );

  it("uses strict decoding for malformed and incomplete sequences", () => {
    expect(() => decodeBytes(documented, "utf-8")).toThrow("UTF-8");
    expect(() => decodeBytes([0xc3], "utf-8")).toThrow("UTF-8");
    expect(() => decodeBytes([0xc0, 0xaf], "utf-8")).toThrow("UTF-8");
    expect(() => decodeBytes([0x81], "gbk")).toThrow("GBK");
    expect(() => decodeBytes([0x81, 0x30, 0x81], "gb18030")).toThrow("GB18030");
    expect(() => decodeBytes([0x41], "utf-16le")).toThrow("UTF-16LE");
    expect(() => decodeBytes([0x00, 0xd8], "utf-16le")).toThrow("UTF-16LE");
    expect(() => decodeBytes([0xd8, 0x00], "utf-16be")).toThrow("UTF-16BE");
  });

  it("keeps the requested UTF-16 byte order and preserves a BOM as data", () => {
    expect(encodeBytes("中", "utf-16le")).toEqual([0x2d, 0x4e]);
    expect(encodeBytes("中", "utf-16be")).toEqual([0x4e, 0x2d]);
    expect(decodeBytes([0xff, 0xfe, 0x41, 0], "utf-16le")).toBe("\ufeffA");
    expect(decodeBytes([0xef, 0xbb, 0xbf, 0x41], "utf-8")).toBe("\ufeffA");
  });

  it("checks encoded byte length rather than character count without truncation", () => {
    expect(encodeBlock("中".repeat(8), "gbk").paddingLength).toBe(0);
    expect(() => encodeBlock("中".repeat(9), "gbk")).toThrow("18 字节");
    expect(() => encodeBlock("中".repeat(6), "utf-8")).toThrow("18 字节");
    expect(() => encodeBlock("41".repeat(17), "hex")).toThrow("17 字节");
    expect(encodeBlock(" A ", "ascii").bytes.slice(0, 3)).toEqual([32, 65, 32]);
    expect(encodeBlock("", "utf-8").bytes).toEqual(Array<number>(16).fill(0));
  });

  it("preserves NUL bytes and makes invisible content inspectable", () => {
    expect(decodeBytes([65, 0, 66, 0], "utf-8")).toBe("A\0B\0");
    expect(visibleText("A\0\n\r\t\\\u202e")).toBe("A\\0\\n\\r\\t\\\\\\u202e");
  });

  it("accepts whitespace in complete HEX but rejects partial or unsupported notation", () => {
    expect(encodeBytes("aA 00\n7f", "hex")).toEqual([0xaa, 0, 0x7f]);
    expect(formatHex([0, 15, 255])).toBe("00 0F FF");
    for (const value of ["0", "0x7F", "AA-GG", "GG", "12,34"]) {
      expect(() => encodeBytes(value, "hex")).toThrow("HEX");
    }
  });

  it("round-trips arbitrary bytes through canonical Base64", () => {
    const data = [0, 127, 128, 255, 3];
    expect(decodeBytes(data, "base64")).toBe("AH+A/wM=");
    expect(encodeBytes("AH+A/\nwM=", "base64")).toEqual(data);
    for (const input of [
      "A",
      "AA",
      "AA=",
      "AB==",
      "AAB=",
      "AA-_",
      "AA==junk",
      "!!!!",
    ]) {
      expect(() => encodeBytes(input, "base64")).toThrow("Base64");
    }
  });

  it.each(BYTE_ENCODINGS.map(({ value }) => value))(
    "rejects invalid bytes in %s",
    (encoding) => {
      for (const data of [[-1], [256], [1.5], [NaN], new Array<number>(1)]) {
        expect(() => decodeBytes(data, encoding)).toThrow("整数字节");
      }
    },
  );
});
