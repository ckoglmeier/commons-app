type ArchiveFile = {
  name: string;
  bytes: Uint8Array;
};

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDate(now = new Date()) {
  const year = Math.max(now.getFullYear(), 1980) - 1980;
  return {
    date: (year << 9) | ((now.getMonth() + 1) << 5) | now.getDate(),
    time: (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2),
  };
}

function write16(target: Uint8Array, offset: number, value: number) {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint16(offset, value, true);
}

function write32(target: Uint8Array, offset: number, value: number) {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(offset, value, true);
}

export function createPhotoArchive(files: ArchiveFile[]) {
  const encoder = new TextEncoder();
  const timestamp = zipDate();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const checksum = crc32(file.bytes);
    const localHeader = new Uint8Array(30 + name.length);
    write32(localHeader, 0, 0x04034b50);
    write16(localHeader, 4, 20);
    write16(localHeader, 6, 0x0800);
    write16(localHeader, 8, 0);
    write16(localHeader, 10, timestamp.time);
    write16(localHeader, 12, timestamp.date);
    write32(localHeader, 14, checksum);
    write32(localHeader, 18, file.bytes.length);
    write32(localHeader, 22, file.bytes.length);
    write16(localHeader, 26, name.length);
    localHeader.set(name, 30);
    localParts.push(localHeader, file.bytes);

    const centralHeader = new Uint8Array(46 + name.length);
    write32(centralHeader, 0, 0x02014b50);
    write16(centralHeader, 4, 20);
    write16(centralHeader, 6, 20);
    write16(centralHeader, 8, 0x0800);
    write16(centralHeader, 10, 0);
    write16(centralHeader, 12, timestamp.time);
    write16(centralHeader, 14, timestamp.date);
    write32(centralHeader, 16, checksum);
    write32(centralHeader, 20, file.bytes.length);
    write32(centralHeader, 24, file.bytes.length);
    write16(centralHeader, 28, name.length);
    write32(centralHeader, 42, localOffset);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + file.bytes.length;
  }

  const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
  const end = new Uint8Array(22);
  write32(end, 0, 0x06054b50);
  write16(end, 8, files.length);
  write16(end, 10, files.length);
  write32(end, 12, centralSize);
  write32(end, 16, localOffset);

  const parts = [...localParts, ...centralParts, end];
  const archive = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    archive.set(part, offset);
    offset += part.length;
  }
  return new Blob([archive.buffer], { type: "application/zip" });
}
