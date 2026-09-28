import { describe, expect, test } from "bun:test";
import { IDLE_TIMEOUT_S, Presence } from "./presence.ts";

describe("independent clients", () => {
  test("an account may hold several sockets at once", () => {
    const p = new Presence();
    p.connect("a", "desktop");
    p.connect("a", "phone");
    expect(p.socketCount("a")).toBe(2);
  });

  test("a second client does not supersede the first", () => {
    const p = new Presence();
    const first = p.connect("a", "desktop");
    const second = p.connect("a", "phone");
    expect(first.firstSocket).toBe(true);
    expect(second.firstSocket).toBe(false);
    expect(p.connectionsOf("a").sort()).toEqual(["desktop", "phone"]);
  });

  test("closing one socket while another is open evicts nobody", () => {
    const p = new Presence();
    p.connect("a", "desktop");
    p.connect("a", "phone");
    expect(p.disconnect("a", "phone")).toEqual({ kind: "still-connected", remaining: 1 });
    expect(p.isConnected("a")).toBe(true);
  });

  test("locking a phone while the desktop is open does not touch the queue", () => {
    // The iOS case: a backgrounded page is suspended and its socket dies, but
    // the desktop socket is still holding the account's entries.
    const p = new Presence();
    p.connect("a", "desktop");
    p.connect("a", "phone");
    expect(p.disconnect("a", "phone").kind).toBe("still-connected");
    expect(p.isConnected("a")).toBe(true);
  });

  test("eviction waits for the LAST socket", () => {
    const p = new Presence();
    p.connect("a", "desktop");
    p.connect("a", "phone");
    expect(p.disconnect("a", "phone").kind).toBe("still-connected");
    expect(p.disconnect("a", "desktop").kind).toBe("evict");
    expect(p.isConnected("a")).toBe(false);
  });

  test("accounts are independent", () => {
    const p = new Presence();
    p.connect("a", "a1");
    p.connect("b", "b1");
    p.disconnect("a", "a1");
    expect(p.isConnected("a")).toBe(false);
    expect(p.isConnected("b")).toBe(true);
  });
});

describe("eviction is immediate and unconditional", () => {
  test("the last socket closing evicts at once", () => {
    const p = new Presence();
    p.connect("a", "only");
    expect(p.disconnect("a", "only")).toEqual({ kind: "evict" });
  });

  test("a deliberate close and a dead router are treated identically", () => {
    // There is no grace window and no close-code branch. The board must not
    // vouch for someone who is not connected, whatever the reason.
    const clean = new Presence();
    clean.connect("a", "only");
    const cleanOut = clean.disconnect("a", "only");

    const abrupt = new Presence();
    abrupt.connect("b", "only");
    const abruptOut = abrupt.disconnect("b", "only");

    expect(cleanOut).toEqual(abruptOut);
  });

  test("disconnecting an unknown connection still resolves to evict", () => {
    const p = new Presence();
    expect(p.disconnect("ghost", "nope")).toEqual({ kind: "evict" });
  });

  test("reconnecting after eviction is an ordinary fresh connection", () => {
    const p = new Presence();
    p.connect("a", "first");
    p.disconnect("a", "first");
    expect(p.connect("a", "second").firstSocket).toBe(true);
  });
});

describe("the ghost window", () => {
  test("idleTimeout is the only delay between vanishing and being forgotten", () => {
    // A silent death - no FIN, nothing tells the server - costs idleTimeout.
    // Everything else fires close within milliseconds. With grace removed there
    // is no second delay stacked on top, so this constant IS the worst case.
    expect(IDLE_TIMEOUT_S).toBe(30);
  });
});
