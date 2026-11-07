/* =====================================================================
   crypto.js
   ===================================================================== */
(function () {
  "use strict";

  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  function sha256Sync(data) {
    const len = data.length;
    const bitLen = len * 8;
    const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    padded.set(data);
    padded[len] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
    dv.setUint32(padded.length - 4, bitLen >>> 0);

    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64);

    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const w15 = W[i - 15], w2 = W[i - 2];
        const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
        const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
    return out;
  }

  function hmacFactory(key) {
    if (key.length > 64) key = sha256Sync(key);
    const ipad = new Uint8Array(64), opad = new Uint8Array(64);
    for (let i = 0; i < 64; i++) { ipad[i] = 0x36 ^ (key[i] || 0); opad[i] = 0x5c ^ (key[i] || 0); }
    const inner = new Uint8Array(64 + 36);
    const outer = new Uint8Array(64 + 32);
    inner.set(ipad); outer.set(opad);
    return function (msg) {
      let buf = inner;
      if (msg.length > 36) { buf = new Uint8Array(64 + msg.length); buf.set(ipad); }
      buf.set(msg, 64);
      const ih = sha256Sync(buf.subarray(0, 64 + msg.length));
      outer.set(ih, 64);
      return sha256Sync(outer);
    };
  }

  function pbkdf2Sync(password, salt, iterations, dkLen) {
    const hmac = hmacFactory(password);
    const blocks = Math.ceil(dkLen / 32);
    const out = new Uint8Array(blocks * 32);
    for (let b = 1; b <= blocks; b++) {
      const msg = new Uint8Array(salt.length + 4);
      msg.set(salt);
      new DataView(msg.buffer).setUint32(salt.length, b);
      let u = hmac(msg);
      const t = new Uint8Array(u);
      for (let i = 1; i < iterations; i++) {
        u = hmac(u);
        for (let j = 0; j < 32; j++) t[j] ^= u[j];
      }
      out.set(t, (b - 1) * 32);
    }
    return out.subarray(0, dkLen);
  }

  const subtle = (typeof crypto !== "undefined" && crypto.subtle) ? crypto.subtle : null;

  async function sha256(bytes) {
    if (subtle) return new Uint8Array(await subtle.digest("SHA-256", bytes));
    return sha256Sync(bytes);
  }

  async function hmacSha256(key, msg) {
    if (subtle) {
      const k = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      return new Uint8Array(await subtle.sign("HMAC", k, msg));
    }
    return hmacFactory(key)(msg);
  }

  async function pbkdf2(password, salt, iterations, dkLen) {
    if (subtle) {
      const k = await subtle.importKey("raw", password, "PBKDF2", false, ["deriveBits"]);
      const bits = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, k, dkLen * 8);
      return new Uint8Array(bits);
    }
    await new Promise((r) => setTimeout(r, 0));
    return pbkdf2Sync(password, salt, iterations, dkLen);
  }

  window.NHCrypto = { sha256, hmacSha256, pbkdf2, usingWebCrypto: !!subtle };
})();
