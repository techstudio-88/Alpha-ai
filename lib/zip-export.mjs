import { deflateRawSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? ((value >>> 1) ^ 0xedb88320) : (value >>> 1);
  return value >>> 0;
});

function crc32(input) {
  let value = 0xffffffff;
  for (const byte of input) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function u16(value) { const buffer = Buffer.alloc(2); buffer.writeUInt16LE(value & 0xffff); return buffer; }
function u32(value) { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value >>> 0); return buffer; }

export function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();

  for (const file of files) {
    const name = String(file.name).replaceAll("\\", "/").replace(/^\/+/, "");
    if (!name || name.includes("../")) throw new Error("Invalid archive path");
    const nameBuffer = Buffer.from(name, "utf8");
    const source = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const compressed = deflateRawSync(source, { level: 6 });
    const method = compressed.length < source.length ? 8 : 0;
    const body = method === 8 ? compressed : source;
    const flags = 0x0800;
    const crc = crc32(source);
    const local = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]), u16(20), u16(flags), u16(method),
      u16(stamp.time), u16(stamp.date), u32(crc), u32(body.length), u32(source.length),
      u16(nameBuffer.length), u16(0), nameBuffer, body,
    ]);
    localParts.push(local);
    centralParts.push(Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x01, 0x02]), u16(20), u16(20), u16(flags), u16(method),
      u16(stamp.time), u16(stamp.date), u32(crc), u32(body.length), u32(source.length),
      u16(nameBuffer.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuffer,
    ]));
    offset += local.length;
  }

  const localData = Buffer.concat(localParts);
  const centralData = Buffer.concat(centralParts);
  return Buffer.concat([
    localData,
    centralData,
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralData.length), u32(localData.length), u16(0),
  ]);
}
