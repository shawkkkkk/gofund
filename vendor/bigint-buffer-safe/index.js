"use strict";

function normalizeBuffer(buf) {
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

function toBigIntLE(input) {
  const buf = normalizeBuffer(input);
  let value = 0n;
  for (let i = buf.length - 1; i >= 0; i -= 1) {
    value = (value << 8n) | BigInt(buf[i]);
  }
  return value;
}

function toBigIntBE(input) {
  const buf = normalizeBuffer(input);
  let value = 0n;
  for (let i = 0; i < buf.length; i += 1) {
    value = (value << 8n) | BigInt(buf[i]);
  }
  return value;
}

function validate(num, width) {
  if (typeof num !== "bigint" || num < 0n) {
    throw new TypeError("num must be a non-negative bigint");
  }
  if (!Number.isInteger(width) || width < 0) {
    throw new TypeError("width must be a non-negative integer");
  }
}

function toBufferLE(num, width) {
  validate(num, width);
  const out = Buffer.alloc(width);
  let value = num;
  for (let i = 0; i < width; i += 1) {
    out[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return out;
}

function toBufferBE(num, width) {
  validate(num, width);
  const out = Buffer.alloc(width);
  let value = num;
  for (let i = width - 1; i >= 0; i -= 1) {
    out[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return out;
}

module.exports = { toBigIntLE, toBigIntBE, toBufferLE, toBufferBE };
