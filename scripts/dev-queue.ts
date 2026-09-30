/**
 * Puts real accounts into the real queue on a LOCAL server, for exercising the
 * board and the ready gate without four browsers.
 *
 *   bun scripts/dev-queue.ts --count 4 --relic "Axi A1" --refinement radiant
 *
 * A driver, not a seeder: genuine accounts holding genuine entries, so closing
 * it empties the board exactly as real people would. Localhost only.
 */

import {
  findRelicByName,
  relicBucketKey,
  searchRelics,
  type Refinement,
} from "@radshare/protocol";

const args = new Map<string, string>();
for (let i = 2; i < Bun.argv.length; i += 2) {
  const key = Bun.argv[i]?.replace(/^--/, "");
  if (key) args.set(key, Bun.argv[i + 1] ?? "");
}

const BASE = args.get("server") ?? "http://127.0.0.1:3000";
const host = new URL(BASE).hostname;
if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
  console.error(`refusing to run against ${host}. This is a localhost tool.`);
  process.exit(1);
}

const count = Number(args.get("count") ?? 3);
const wanted = args.get("relic") ?? "Axi A1";
const refinement = args.get("refinement") ?? "radiant";

const relic = findRelicByName(wanted);
if (!relic) {
  const near = searchRelics(wanted, 5).map((r) => r.name);
  console.error(`no relic named "${wanted}".`);
  if (near.length > 0) console.error(`did you mean: ${near.join(", ")}`);
  process.exit(1);
}
const bucketKey = relicBucketKey(relic.id, refinement as Refinement);

const sockets: WebSocket[] = [];

for (let i = 0; i < count; i += 1) {
  const account = `devqueue-${i + 1}`;
  const ign = `devtenno${i + 1}`;

  const res = await fetch(`${BASE}/api/account`, {
    method: "POST",
    headers: { "x-dev-account": account, "content-type": "application/json" },
    body: JSON.stringify({ ign, platform: "pc" }),
  });
  if (!res.ok) {
    console.error(`could not create ${ign}: ${res.status} ${await res.text()}`);
    console.error("is the server running with RADSHARE_DEV_AUTH=1?");
    process.exit(1);
  }

  const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/ws`, {
    headers: { "x-dev-account": account },
  } as unknown as string[]);

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "queue.join", selection: [bucketKey] }));
    console.log(`${ign} queued for ${relic.name} ${refinement}`);
  });
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(String(e.data)) as { type: string; code?: string };
    if (msg.type === "error") console.error(`${ign}: ${msg.code}`);
    // Confirm, so the lobby forms and the screen under test appears.
    if (msg.type === "ready.check") {
      const gateId = (JSON.parse(String(e.data)) as { gateId: string }).gateId;
      console.log(`${ign} confirming ready`);
      ws.send(JSON.stringify({ type: "ready.confirm", gateId }));
    }
  });

  sockets.push(ws);
  await Bun.sleep(80);
}

console.log(`\n${count} in ${bucketKey}. Ctrl-C to release them.`);

process.on("SIGINT", () => {
  for (const ws of sockets) ws.close(1000);
  console.log("\nreleased");
  process.exit(0);
});

await new Promise(() => {});
