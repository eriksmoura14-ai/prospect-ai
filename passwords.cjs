"use strict";

const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);
const parameters = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
let active = false;
const waiting = [];

// One 128 MiB hash at a time avoids exhausting the free service's RAM.
function bounded(work) {
  if (waiting.length >= 4) return Promise.reject(Object.assign(new Error("Aguarde antes de tentar novamente."), { status: 429 }));
  return new Promise((resolve, reject) => {
    const run = async () => {
      active = true;
      try { resolve(await work()); } catch (error) { reject(error); }
      finally { const next = waiting.shift(); if (next) void next(); else active = false; }
    };
    if (active) waiting.push(run); else void run();
  });
}
function normalize(value, creating = false) {
  if (typeof value !== "string") throw Object.assign(new Error("Informe sua senha."), { status: 400 });
  const password = value.normalize("NFC");
  const length = [...password].length;
  if (length > 128 || Buffer.byteLength(password) > 512 || !length ||
      (creating && (length < 9 || !/[0-9]/.test(password)))) {
    const message = creating
      ? "Use uma senha de 9 a 128 caracteres com pelo menos um número. O ponto (.) é permitido."
      : "Informe sua senha do Prospect AI, com até 128 caracteres.";
    throw Object.assign(new Error(message), { status: 400 });
  }
  return password;
}
async function hashPassword(value) {
  const password = normalize(value, true);
  return bounded(async () => {
    const salt = crypto.randomBytes(16);
    const result = await scrypt(password, salt, 32, parameters);
    return `scrypt$131072$8$1$${salt.toString("hex")}$${result.toString("hex")}`;
  });
}
async function verifyPassword(value, encoded) {
  const password = normalize(value);
  const match = /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(encoded || "");
  return bounded(async () => {
    // Unknown identities cost the same hash as known identities.
    const actual = await scrypt(password, match ? Buffer.from(match[1], "hex") : Buffer.alloc(16), 32, parameters);
    const expected = match ? Buffer.from(match[2], "hex") : Buffer.alloc(32);
    return crypto.timingSafeEqual(actual, expected) && Boolean(match);
  });
}
module.exports = { hashPassword, verifyPassword, normalize };
