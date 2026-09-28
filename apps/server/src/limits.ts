/**
 * Abuse limits. Synchronous and time-injected, like everything else that has to
 * be testable without a clock.
 *
 * The anonymous surface is a cached `GET /api/board`, so the cheapest flood is
 * absorbed by the cache rather than by socket state. What remains reachable by
 * socket is an authenticated account, which is a far narrower surface — but the
 * deployment is deliberately one box, so it still needs limits.
 */

export const MAX_SOCKETS_PER_IP = 5;
export const MESSAGE_BURST = 20;
export const MESSAGE_WINDOW_MS = 10_000;

/**
 * Resolve the real client address.
 *
 * VERIFIED against Caddy 2.11.4 (see T-spike): behind the proxy the socket peer
 * is `::ffff:127.0.0.1`, AND the peer port repeats across separate requests
 * because Caddy pools its upstream connection. The peer is therefore not merely
 * always-loopback — it is a single connection SHARED BETWEEN VISITORS. Keying a
 * per-IP cap on it would count the entire userbase as one person and lock
 * everyone out at the sixth connection.
 *
 * Caddy REPLACES `X-Forwarded-For` rather than appending, so a client forging
 * the header has it discarded. That safety is a property of the default config:
 * adding `trusted_proxies` to the Caddyfile makes Caddy append and trust what
 * the client sent. We take the LAST value regardless, which is the entry the
 * nearest proxy added and is therefore the correct choice under both configs.
 *
 * `peerFallback` is for local development with no proxy in front.
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

/** Strips an IPv6-mapped IPv4 prefix and any port, so one address has one spelling. */
export function normalizeIp(raw: string): string {
  let ip = raw.trim();

  // [2001:db8::1]:443 -> 2001:db8::1
  const bracket = /^\[(.+?)\](?::\d+)?$/.exec(ip);
  if (bracket?.[1]) ip = bracket[1];

  // ::ffff:127.0.0.1:59807 -> 127.0.0.1:59807
  // Must happen BEFORE the port strip: the mapped prefix contributes colons, so
  // a naive "does it look like host:port" test misreads the whole string. Get
  // this order wrong and every request from one client keys on its ephemeral
  // port, which means the cap silently never fires.
  const mapped = /^::ffff:(.+)$/i.exec(ip);
  if (mapped?.[1]) ip = mapped[1];

  // 203.0.113.7:443 -> 203.0.113.7 (bare IPv6 cannot carry a port unbracketed)
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(":"));

  return ip;
}

/**
 * Concurrent sockets per address. Checked at the UPGRADE handshake rather than
 * after, so a connection flood never allocates socket state.
 */
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

/**
 * Per-socket message allowance. Over-limit messages are dropped with an
 * explicit `RATE_LIMITED` error, never silently.
 */
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
