// Schema-Versionierung des lokalen Speichers.
// Version 1 (ohne Schema-Eintrag): progress, packages, days, meta/settings.
// Version 2: zusätzlich reviews, cardmeta; progress.againCount; settings.requestRetention,
//            fsrsParams, hearingMode, verbMode; days: newCount/reviewCount unverändert.
export const SCHEMA_VERSION = 2;

/**
 * Speicher auf die aktuelle Schemaversion heben. Idempotent, verlustfrei.
 * @returns {{from:number, to:number, migrated:boolean}}
 */
export async function migrateSchema(storage) {
  const row = await storage.get('meta', 'schema');
  const from = row && Number.isFinite(row.version) ? row.version : 1;
  if (from >= SCHEMA_VERSION) return { from, to: from, migrated: false };

  if (from < 2) {
    // Lernstände: Zähler für „Nochmal“ ergänzen, ohne FSRS-Felder anzufassen.
    const progress = await storage.getAll('progress');
    const patched = progress
      .filter((p) => p && typeof p.id === 'string' && typeof p.againCount !== 'number')
      .map((p) => ({ ...p, againCount: 0 }));
    if (patched.length) await storage.putMany('progress', patched);
  }

  await storage.put('meta', { id: 'schema', version: SCHEMA_VERSION, migratedAt: new Date().toISOString(), from });
  return { from, to: SCHEMA_VERSION, migrated: true };
}
