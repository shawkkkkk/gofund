const assert = require("node:assert/strict");
const {
  toBigIntLE,
  toBigIntBE,
  toBufferLE,
  toBufferBE,
} = require("bigint-buffer");

assert.equal(toBigIntLE(Buffer.from([0x78, 0x56, 0x34, 0x12])), 0x12345678n);
assert.equal(toBigIntBE(Buffer.from([0x12, 0x34, 0x56, 0x78])), 0x12345678n);
assert.deepEqual([...toBufferLE(0x12345678n, 4)], [0x78, 0x56, 0x34, 0x12]);
assert.deepEqual([...toBufferBE(0x12345678n, 4)], [0x12, 0x34, 0x56, 0x78]);
assert.equal(toBigIntLE(Buffer.alloc(0)), 0n);
assert.deepEqual([...toBufferLE(0x1234n, 1)], [0x34]);

process.stdout.write("safe bigint-buffer compatibility smoke test passed\n");
