/**
 * MySQL -> Neo4j sync CLI (run from web/):
 *
 *   npm run sync:graph                 process PENDING outbox events once
 *   npm run sync:graph -- --watch      keep processing every 5 s (Ctrl+C to stop)
 *   npm run sync:graph -- --watch=2    ... every 2 s
 *   npm run sync:graph -- --full       rebuild mirrored data from a MySQL snapshot,
 *                                      then process the pending log
 *   npm run sync:graph -- --verify     compare graph vs MySQL (exit 1 on drift)
 *   npm run sync:graph -- --stats      outbox counts per status
 *
 * Reads the repo-root .env like the web app.
 */
import { closePool } from "../lib/db";
import { outboxStats, processOutbox, rebuildGraph, verifyGraph } from "../lib/graph-sync";
import { closeDriver } from "../lib/neo4j";

const args = process.argv.slice(2);
const has = (flag: string) => args.some((a) => a === flag || a.startsWith(`${flag}=`));
const value = (flag: string) => args.find((a) => a.startsWith(`${flag}=`))?.split("=")[1];
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

async function verify(): Promise<boolean> {
  const v = await verifyGraph();
  log(`verify: mysql=${v.mysqlEntries} graph=${v.graphEntries} ${v.ok ? "IN SYNC" : "DRIFT DETECTED"}`);
  for (const k of v.missingInGraph.slice(0, 20)) console.log(`  missing in graph: ${k}`);
  for (const k of v.extraInGraph.slice(0, 20)) console.log(`  extra in graph:   ${k}`);
  return v.ok;
}

async function main(): Promise<number> {
  if (has("--stats")) {
    log(`outbox: ${JSON.stringify(await outboxStats())}`);
    return 0;
  }
  if (has("--verify")) {
    return (await verify()) ? 0 : 1;
  }
  if (has("--full")) {
    const r = await rebuildGraph();
    log(`rebuild from MySQL snapshot: ${JSON.stringify(r)}`);
  }

  if (has("--watch")) {
    const seconds = Number(value("--watch") ?? 5);
    log(`watching outbox every ${seconds}s (Ctrl+C to stop)`);
    let stopping = false;
    process.on("SIGINT", () => {
      stopping = true;
    });
    while (!stopping) {
      const r = await processOutbox();
      if (r.applied || r.skipped || r.failed || r.blockedAt) {
        log(`applied=${r.applied} skipped=${r.skipped} failed=${r.failed} pending=${r.remainingPending}`);
      }
      await new Promise((res) => setTimeout(res, seconds * 1000));
    }
    return 0;
  }

  const r = await processOutbox({ log });
  if (!r.lockAcquired) return 0;
  log(`outbox: ${JSON.stringify(await outboxStats())}`);
  const ok = await verify();
  return r.blockedAt || !ok ? 1 : 0;
}

main()
  .then(async (code) => {
    await Promise.all([closePool(), closeDriver()]);
    process.exit(code);
  })
  .catch(async (e: unknown) => {
    console.error(e);
    await Promise.all([closePool(), closeDriver()]).catch(() => undefined);
    process.exit(1);
  });
