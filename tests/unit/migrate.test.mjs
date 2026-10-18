import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateSchema, SCHEMA_VERSION } from '../../js/migrate.js';

/** Minimaler Speicher im Arbeitsspeicher mit derselben Schnittstelle wie storage.js. */
function memStorage(initial = {}) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, new Map(v.map((r) => [r.id, r]))]));
  const store = (s) => data.get(s) || data.set(s, new Map()).get(s);
  return {
    kind: 'memory',
    async get(s, k) {
      return store(s).get(k);
    },
    async getAll(s) {
      return [...store(s).values()];
    },
    async put(s, v) {
      store(s).set(v.id, v);
    },
    async putMany(s, vs) {
      for (const v of vs) store(s).set(v.id, v);
    },
    async delete(s, k) {
      store(s).delete(k);
    },
    async clear(s) {
      store(s).clear();
    },
  };
}

test('Migration v1 → v2: Lernstände bleiben erhalten, againCount wird ergänzt, Schema gesetzt', async () => {
  const v1progress = { id: 'ES-0001', due: '2026-10-20T10:00:00.000Z', stability: 8.3, difficulty: 1, elapsed_days: 0, scheduled_days: 8, reps: 1, lapses: 0, state: 2, last_review: '2026-10-12T10:00:00.000Z' };
  const st = memStorage({ progress: [v1progress], days: [{ id: '2026-10-12', newCount: 1, reviewCount: 1 }], meta: [{ id: 'settings', newPerDay: 20, autoSpeak: true }] });
  const r = await migrateSchema(st);
  assert.deepEqual({ from: r.from, to: r.to, migrated: r.migrated }, { from: 1, to: SCHEMA_VERSION, migrated: true });
  const p = await st.get('progress', 'ES-0001');
  assert.equal(p.againCount, 0);
  assert.equal(p.due, v1progress.due);
  assert.equal(p.state, 2);
  assert.equal((await st.get('meta', 'schema')).version, SCHEMA_VERSION);
  const again = await migrateSchema(st);
  assert.equal(again.migrated, false, 'idempotent');
});
