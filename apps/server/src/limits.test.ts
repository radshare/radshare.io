import { describe, expect, test } from "bun:test";
import {
  ConnectionCap,
  MESSAGE_BURST,
  MESSAGE_WINDOW_MS,
  MessageLimiter,
  clientIp,
  normalizeIp,
} from "./limits.ts";

function headers(init: Record<string, string> = {}): Headers {
  return new Headers(init);
}

describe("clientIp", () => {
  // The failure this guards against locks out EVERY user at once, so it is
  // worth more tests than it looks like it deserves.

  test("prefers X-Forwarded-For over the socket peer", () => {
    const ip = clientIp(headers({ "x-forwarded-for": "203.0.113.7" }), "::ffff:127.0.0.1:59807");
    expect(ip).toBe("203.0.113.7");
  });

  test("never returns the pooled loopback peer when a forwarded header exists", () => {
    // Caddy pools its upstream connection, so this peer is shared between
    // different visitors. Returning it would collapse the whole userbase to one key.
    const a = clientIp(headers({ "x-forwarded-for": "198.51.100.1" }), "::ffff:127.0.0.1:59807");
    const b = clientIp(headers({ "x-forwarded-for": "198.51.100.2" }), "::ffff:127.0.0.1:59807");
    expect(a).not.toBe(b);
  });

  test("takes the LAST value of a chain — the entry the nearest proxy added", () => {
    // Caddy replaces rather than appends by default, so a chain only appears if
    // someone adds trusted_proxies. The rightmost entry is still the trustworthy one.
    const ip = clientIp(headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.9" }), null);
    expect(ip).toBe("203.0.113.9");
  });

  test("falls back to the peer when there is no proxy in front (local dev)", () => {
    expect(clientIp(headers(), "::ffff:192.0.2.5:1234")).toBe("192.0.2.5");
  });

  test("returns null when the address cannot be attributed at all", () => {
    expect(clientIp(headers(), null)).toBeNull();
  });
});

describe("normalizeIp", () => {
  test("strips IPv6-mapped IPv4 prefixes and ports so one address has one spelling", () => {
    expect(normalizeIp("::ffff:127.0.0.1:59807")).toBe("127.0.0.1");
    expect(normalizeIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeIp("203.0.113.7:443")).toBe("203.0.113.7");
    expect(normalizeIp("203.0.113.7")).toBe("203.0.113.7");
  });

  test("leaves a bare IPv6 address intact", () => {
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8::1");
    expect(normalizeIp("[2001:db8::1]:443")).toBe("2001:db8::1");
  });

  test("two spellings of the same address collapse to one key", () => {
    expect(normalizeIp("::ffff:203.0.113.7:9999")).toBe(normalizeIp("203.0.113.7"));
  });
});

describe("ConnectionCap", () => {
  test("admits up to the cap and rejects beyond it", () => {
    const cap = new ConnectionCap(5);
    for (let i = 0; i < 5; i++) expect(cap.admit("203.0.113.1", `c${i}`)).toBe(true);
    expect(cap.admit("203.0.113.1", "c5")).toBe(false);
  });

  test("releasing frees a slot", () => {
    const cap = new ConnectionCap(2);
    cap.admit("203.0.113.1", "a");
    cap.admit("203.0.113.1", "b");
    expect(cap.admit("203.0.113.1", "c")).toBe(false);
    cap.release("203.0.113.1", "a");
    expect(cap.admit("203.0.113.1", "c")).toBe(true);
  });

  test("addresses are independent — one busy visitor does not block another", () => {
    const cap = new ConnectionCap(1);
    expect(cap.admit("203.0.113.1", "a")).toBe(true);
    expect(cap.admit("203.0.113.2", "b")).toBe(true);
  });

  test("re-admitting the same connection id is idempotent", () => {
    const cap = new ConnectionCap(1);
    expect(cap.admit("203.0.113.1", "a")).toBe(true);
    expect(cap.admit("203.0.113.1", "a")).toBe(true);
    expect(cap.count("203.0.113.1")).toBe(1);
  });

  test("an unattributable address is never punished", () => {
    const cap = new ConnectionCap(1);
    for (let i = 0; i < 50; i++) expect(cap.admit(null, `c${i}`)).toBe(true);
  });

  test("releasing the last connection forgets the address entirely", () => {
    const cap = new ConnectionCap(5);
    cap.admit("203.0.113.1", "a");
    cap.release("203.0.113.1", "a");
    expect(cap.count("203.0.113.1")).toBe(0);
  });
});

describe("MessageLimiter", () => {
  test("allows a full burst then refuses", () => {
    const l = new MessageLimiter();
    for (let i = 0; i < MESSAGE_BURST; i++) expect(l.allow("c", 1000)).toBe(true);
    expect(l.allow("c", 1000)).toBe(false);
  });

  test("refills over the window", () => {
    const l = new MessageLimiter();
    for (let i = 0; i < MESSAGE_BURST; i++) l.allow("c", 1000);
    expect(l.allow("c", 1000)).toBe(false);
    // half a window later, half the burst is back
    expect(l.allow("c", 1000 + MESSAGE_WINDOW_MS / 2)).toBe(true);
  });

  test("a full window restores the whole burst but never more", () => {
    const l = new MessageLimiter();
    for (let i = 0; i < MESSAGE_BURST; i++) l.allow("c", 1000);
    const far = 1000 + MESSAGE_WINDOW_MS * 100;
    for (let i = 0; i < MESSAGE_BURST; i++) expect(l.allow("c", far)).toBe(true);
    expect(l.allow("c", far)).toBe(false);
  });

  test("sockets are independent", () => {
    const l = new MessageLimiter();
    for (let i = 0; i < MESSAGE_BURST; i++) l.allow("a", 1000);
    expect(l.allow("a", 1000)).toBe(false);
    expect(l.allow("b", 1000)).toBe(true);
  });

  test("forget releases the socket's state", () => {
    const l = new MessageLimiter();
    for (let i = 0; i < MESSAGE_BURST; i++) l.allow("c", 1000);
    expect(l.allow("c", 1000)).toBe(false);
    l.forget("c");
    expect(l.allow("c", 1000)).toBe(true);
  });
});
