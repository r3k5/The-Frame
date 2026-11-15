"""Draw a 117-pixel Tizen icon using the Python standard library."""
from pathlib import Path
import struct
import zlib

size = 117
rows = []
for y in range(size):
    # PNG filter type zero stores the RGB bytes of this row directly.
    row = bytearray([0])
    for x in range(size):
        outer = 30 <= x <= 86 and 22 <= y <= 94 and (x < 34 or x > 82 or y < 26 or y > 90)
        inner = 41 <= x <= 75 and 33 <= y <= 83 and (x < 43 or x > 73 or y < 35 or y > 81)
        row.extend((232, 222, 196) if outer or inner else (32, 45, 35))
    rows.append(bytes(row))

# Each PNG chunk carries a length and checksum around its payload.
def chunk(name, data):
    return struct.pack('!I', len(data)) + name + data + struct.pack('!I', zlib.crc32(name + data) & 0xffffffff)

png = b'\x89PNG\r\n\x1a\n'
png += chunk(b'IHDR', struct.pack('!2I5B', size, size, 8, 2, 0, 0, 0))
png += chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b'')
target = Path(__file__).resolve().parent.parent / 'assets' / 'icon.png'
target.write_bytes(png)
print(target)
