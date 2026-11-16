# MySQL → Neo4j Synchronisation (Transactional Outbox)

SkillMatch keeps **MySQL as the source of truth**. Neo4j holds a copy of the data that benefits from graph traversal (candidates, jobs, skills, companies and the `HAS_SKILL` / `REQUIRES_SKILL` / `OFFERED_BY` links), plus graph-only data that exists only in Neo4j (`RELATED_TO`, `SUBSKILL_OF`, `WORKED_AT`, `CONNECTED_TO`).

This document explains how changes travel from MySQL to Neo4j, and what consistency the application can rely on.

## 1. Why an outbox

Writing to MySQL and then to Neo4j from the API ("dual write") can leave the two stores disagreeing. If the process crashes between the writes, or the Neo4j write fails after MySQL committed, the graph silently drifts. There is no distributed transaction across the two databases.

The **transactional outbox** avoids this:

1. Triggers on `candidates`, `users`, `skills`, `candidate_skills`, `jobs`, `job_skills` and `recruiters` insert a row into `graph_sync_outbox`. Because a trigger runs inside the same transaction as the business change, **an event exists if and only if the change committed**.
2. A worker reads the PENDING events and applies them to Neo4j.

```
API ──► MySQL transaction ─┬─► business tables
                           └─► graph_sync_outbox (same commit)
                                      │
                    worker (web/lib/graph-sync.ts)
                                      │  MERGE / SET / DETACH DELETE
                                      ▼
                                    Neo4j
```

## 2. Event format

| Column | Meaning |
| :--- | :--- |
| `entity_type` | `CANDIDATE`, `SKILL`, `CANDIDATE_SKILL`, `JOB`, `JOB_SKILL` |
| `entity_id` | `'5'`, or `'5:12'` for composite keys |
| `op` | `UPSERT` (payload = full row snapshot) or `DELETE` (payload `NULL`) |
| `status` / `attempts` / `last_error` | `PENDING` → `DONE`, or `FAILED` after 5 attempts |

Two special cases are handled explicitly:

- **FK cascades do not fire triggers in MySQL.** Deleting a user cascades to `candidates` silently, so a trigger on `users` emits the `CANDIDATE DELETE`. Child relationships disappear in Neo4j through `DETACH DELETE` of the parent node.
- **Companies have no trigger.** The worker reads the company row from MySQL when it applies a `JOB` event. A recruiter moving company re-emits `JOB` events for that recruiter's jobs.

## 3. Worker guarantees

| Property | How |
| :--- | :--- |
| **One consumer at a time** | MySQL advisory lock `GET_LOCK('skillmatch_graph_sync', 0)`. A second worker returns immediately. The lock belongs to the pooled connection, so it is released explicitly in `finally`. |
| **Order** | Events are applied in `event_id` order, i.e. commit-time order for the same entity. |
| **Failure doesn't reorder** | The batch stops at the first failing event, so a later change to the same entity can never overtake an earlier one. After 5 attempts the event is **parked as `FAILED`** (with `last_error`) and the queue continues. An admin can inspect it and retry it (Phase 7). |
| **At-least-once + idempotent** | Neo4j is written first, then the event is marked `DONE`. If the process dies in between, the event is applied again. This is harmless because every write is idempotent (see §4). |
| **No partial events** | Each event is one Neo4j write transaction. |

## 4. Idempotency

| Event | Cypher | Applying it twice |
| :--- | :--- | :--- |
| `*` UPSERT | `MERGE (n:Label {id}) SET n.prop = …` | Same node, same properties |
| `*_SKILL` UPSERT | `MATCH` both endpoints, `MERGE` the relationship, `SET` props | Same relationship. If an endpoint was already deleted later in the log, the event is a no-op ("skipped"). |
| `*` DELETE | `MATCH … DETACH DELETE` / `DELETE r` | Deleting something already gone is a no-op |
| `JOB` UPSERT | `MERGE` job and company, remove any other `OFFERED_BY`, `MERGE` the current one | Exactly one `OFFERED_BY` |

Ids are sent as Neo4j integers (`neo4j.int`), so a re-applied event can never create a duplicate node with a float id.

**Proof (automated):** `web/tests/sync.test.ts` resets the *entire* outbox history to `PENDING` and replays it **twice**. The full set of mirrored nodes and relationships, with all properties, is identical before and after, and the graph-only relationship counts are unchanged.

## 5. Consistency model: eventual

- Neo4j may lag MySQL until the worker runs. Graph-backed screens (skill gap, recommendations, graph ranking) can be slightly stale. Transactional screens (applications, pipeline, audit log) always read MySQL.
- API routes that change mirrored data call `requestGraphSync()` (`web/lib/sync-trigger.ts`) **after** their MySQL commit. This runs the worker in the background without delaying or failing the HTTP response.
- `npm run sync:graph -- --watch` keeps a worker polling (every 5 s by default) for demos.

## 6. Repair and verification

| Command (run in `web/`) | Effect |
| :--- | :--- |
| `npm run sync:graph` | Process pending events once, then verify graph vs MySQL (exit code 1 on drift or a blocked event) |
| `npm run sync:graph -- --watch[=s]` | Keep processing every *s* seconds |
| `npm run sync:graph -- --verify` | Compare every mirrored node and relationship (including properties) in both stores |
| `npm run sync:graph -- --full` | Rebuild all mirrored data from one consistent MySQL snapshot (`START TRANSACTION WITH CONSISTENT SNAPSHOT`), delete mirrored nodes that no longer exist, then process the pending log. Graph-only relationships are never touched. |
| `npm run sync:graph -- --stats` | Outbox counts per status |

## 7. Verified results (Phase 4)

| Check | Result |
| :--- | :--- |
| Seed backlog (234 events) replayed onto the Phase 2 graph | Applied, graph IN SYNC (224 mirrored entries) |
| Insert / update / delete for candidates, skills and jobs, plus cascade delete through `users` | Reflected in Neo4j |
| Full outbox history replayed twice | Graph unchanged |
| Poison event | Blocked later events, then parked as `FAILED`; the queue continued |
| Concurrent worker | Rejected by the advisory lock |
| Drift (lost relationship, stray node, edited property) + `--full` | Repaired; graph-only relationships kept |
