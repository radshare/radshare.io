/**
 * Puts real accounts into the real queue on your LOCAL server, so the board
 * has something on it while the queue composer does not exist yet.
 *
 * This is a driver, not a seeder. It creates genuine accounts and opens
 * genuine sockets that hold genuine queue entries — close it and the board
 * empties, exactly as it would for real people. Nothing it produces is written
 * into the product, and it refuses to run against anything but localhost so it
 * cannot be pointed at a deployment.
 *
 *   bun scripts/dev-queue.ts                       three in one bucket
 *   bun scripts/dev-queue.ts --count 3 --relic "Axi A2" --refinement radiant
 *
 * Leave it running. Ctrl-C releases everyone.
 */

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
const relic = args.get("relic") ?? "Axi A2";
const refinement = args.get("refinement") ?? "radiant";
const bucketKey = `${relic}:${refinement}`;

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
    console.log(`${ign} queued for ${relic} ${refinement}`);
  });
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(String(e.data)) as { type: string; code?: string };
    if (msg.type === "error") console.error(`${ign}: ${msg.code}`);
    // A ready check means a real person completed the bucket. Confirm, so the
    // lobby actually forms and you can see the screen you were testing for.
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
