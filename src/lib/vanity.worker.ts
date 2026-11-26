/// <reference lib="webworker" />
/**
 * Searches random ed25519 keys for one whose Solana address (base58 of the public key) ends in the
 * requested suffix. The last base58 characters of a number are its remainder modulo 58^n, so each
 * candidate costs one key generation plus a short remainder, no full base58 encoding.
 * Uses the browser's native Ed25519 (WebCrypto) when available, about 2-3x faster, else @noble/curves.
 */
import { ed25519 } from '@noble/curves/ed25519'

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function matcher(suffix: string) {
  let mod = 1
  let target = 0
  for (const ch of suffix) {
    target = target * 58 + ALPHABET.indexOf(ch)
    mod *= 58
  }
  return (pub: Uint8Array) => {
    let r = 0
    for (let i = 0; i < 32; i++) r = (r * 256 + pub[i]) % mod
    return r === target
  }
}

const done = (seed: Uint8Array) => (self as unknown as Worker).postMessage({ seed: Array.from(seed) })

async function native(hit: (p: Uint8Array) => boolean) {
  const gen = () => crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign']) as Promise<CryptoKeyPair>
  await gen() // throws if this browser has no native Ed25519
  for (;;) {
    const pairs = await Promise.all(Array.from({ length: 64 }, gen))
    const pubs = await Promise.all(pairs.map((k) => crypto.subtle.exportKey('raw', k.publicKey)))
    for (let i = 0; i < pairs.length; i++) {
      if (!hit(new Uint8Array(pubs[i]))) continue
      // PKCS#8 for Ed25519 is a 16-byte header followed by the 32-byte seed
      const pk = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pairs[i].privateKey))
      return done(pk.slice(pk.length - 32))
    }
  }
}

function fallback(hit: (p: Uint8Array) => boolean) {
  const seed = new Uint8Array(32)
  for (;;) {
    crypto.getRandomValues(seed)
    if (hit(ed25519.getPublicKey(seed))) return done(seed)
  }
}

self.onmessage = (e: MessageEvent<{ suffix: string }>) => {
  const hit = matcher(e.data.suffix)
  native(hit).catch(() => fallback(hit))
}
