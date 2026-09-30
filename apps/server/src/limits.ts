/**
 * Abuse limits. The anonymous surface is a cached endpoint, so the cheapest
 * flood never reaches socket state — but the deployment is one box, so what
 * remains still needs limits.
 */

export const MAX_SOCKETS_PER_IP = 5;
export const MESSAGE_BURST = 20;
export const MESSAGE_WINDOW_MS = 10_000;

/**
 * The real client address.
 *
 * VERIFIED on Caddy 2.11.4: the peer is `::ffff:127.0.0.1` AND its port repeats
 * across requests, because Caddy pools its upstream connection — the peer is
 * one connection SHARED BETWEEN VISITORS. Keying a per-IP cap on it locks out
 * the whole userbase at the sixth connection.
 *
 * Caddy replaces `X-Forwarded-For`, so forged values are discarded; adding
 * `trusted_proxies` changes that. We take the LAST value, which is correct
 * under both configs.
 */
export function clientIp(headers: Headers, peerFallback: string | null): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return normalizeIp(last);
  }
  return peerFallback ? normalizeIp(peerFallback) : null;
}

/** One address, one spelling. */
export function normalizeIp(raw: string): string {
  let ip = raw.trim();

  // [2001:db8::1]:443 -> 2001:db8::1
  const bracket = /^\[(.+?)\](?::\d+)?$/.exec(ip);
  if (bracket?.[1]) ip = bracket[1];

  // ::ffff:127.0.0.1:59807 -> 127.0.0.1:59807
  // BEFORE the port strip: the mapped prefix contributes colons, so a host:port
  // test misreads the string and every request keys on its ephemeral port --
  // which means the cap silently never fires.
  const mapped = /^::ffff:(.+)$/i.exec(ip);
  if (mapped?.[1]) ip = mapped[1];

  // 203.0.113.7:443 -> 203.0.113.7 (bare IPv6 cannot carry a port unbracketed)
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(":"));

  return ip;
}

/** Checked at the UPGRADE handshake, so a flood never allocates socket state. */
export class ConnectionCap {
  #byIp = new Map<string, Set<string>>();

  constructor(private readonly max: number = MAX_SOCKETS_PER_IP) {}

  /** True when the connection was admitted. False means reject the upgrade. */
  admit(ip: string | null, connectionId: string): boolean {
    if (ip === null) return true; // cannot attribute it; do not punish
    const held = this.#byIp.get(ip) ?? new Set<string>();
    if (!held.has(connectionId) && held.size >= this.max) return false;
    held.add(connectionId);
    this.#byIp.set(ip, held);
    return true;
  }

  release(ip: string | null, connectionId: string): void {
    if (ip === null) return;
    const held = this.#byIp.get(ip);
    if (!held) return;
    held.delete(connectionId);
    if (held.size === 0) this.#byIp.delete(ip);
  }

  count(ip: string): number {
    return this.#byIp.get(ip)?.size ?? 0;
  }
}

/** Over-limit messages are dropped with an explicit code, never silently. */
export class MessageLimiter {
  #state = new Map<string, { tokens: number; lastRefill: number }>();

  constructor(
    private readonly burst: number = MESSAGE_BURST,
    private readonly windowMs: number = MESSAGE_WINDOW_MS,
  ) {}

  /** True when the message is allowed. */
  allow(connectionId: string, now: number): boolean {
    const s = this.#state.get(connectionId) ?? { tokens: this.burst, lastRefill: now };
    const elapsed = now - s.lastRefill;
    if (elapsed > 0) {
      const refill = (elapsed / this.windowMs) * this.burst;
      s.tokens = Math.min(this.burst, s.tokens + refill);
      s.lastRefill = now;
    }
    if (s.tokens < 1) {
      this.#state.set(connectionId, s);
      return false;
    }
    s.tokens -= 1;
    this.#state.set(connectionId, s);
    return true;
  }

  forget(connectionId: string): void {
    this.#state.delete(connectionId);
  }
}
