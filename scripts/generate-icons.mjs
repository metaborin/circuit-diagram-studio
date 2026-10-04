// Original circuit symbol, drawn from geometric primitives. No external artwork or fonts.
import { mkdir, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'

const directory = new URL('../public/icons/', import.meta.url)
await mkdir(directory, { recursive: true })
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const label = Buffer.from(type)
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length)
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([label, data])))
  return Buffer.concat([header, label, data, tail])
}
function ink(x, y) {
  const line = (x1, y1, x2, y2) => {
    const t = Math.max(0, Math.min(1, ((x-x1)*(x2-x1)+(y-y1)*(y2-y1))/((x2-x1)**2+(y2-y1)**2)))
    return Math.hypot(x-x1-t*(x2-x1), y-y1-t*(y2-y1)) <= 8
  }
  const ring = (cx, cy) => { const d = Math.hypot(x-cx, y-cy); return d >= 13 && d <= 23 }
  return ring(144, 160) || ring(368, 352) || ring(144, 352)
    || line(167,160,256,160) || line(256,160,256,216)
    || line(256,296,256,352) || line(256,352,345,352)
    || line(167,352,192,352) || line(192,352,192,256) || line(192,256,216,256)
    || ((x >= 216 && x <= 296 && y >= 216 && y <= 296)
      && !(x > 232 && x < 280 && y > 232 && y < 280))
}
function png(size) {
  const bytes = Buffer.alloc(size * (1 + size * 3))
  const background = [23, 60, 50], foreground = [247, 249, 228]
  for (let y=0; y<size; y++) for (let x=0; x<size; x++) {
    let coverage = 0
    for (let sy=0; sy<4; sy++) for (let sx=0; sx<4; sx++) {
      if (ink((x+(sx+.5)/4)*512/size, (y+(sy+.5)/4)*512/size)) coverage++
    }
    const offset = y * (1+size*3) + 1+x*3
    for (let c=0;c<3;c++) bytes[offset+c] = Math.round(background[c]+(foreground[c]-background[c])*coverage/16)
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size,4); header[8]=8; header[9]=2
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',header), chunk('IDAT',deflateSync(bytes)), chunk('IEND',Buffer.alloc(0))])
}
for (const [name,size] of [['circuit-192.png',192],['circuit-512.png',512],['circuit-maskable-512.png',512],['apple-touch-icon.png',180]]) {
  await writeFile(new URL(name,directory),png(size))
}
