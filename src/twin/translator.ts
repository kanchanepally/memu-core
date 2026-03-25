import { pool } from '../db/connection';

// Fallback logic in case DB is empty during initial Slice 1 testing
const FALLBACK_ENTITIES = [
  { real_name: 'Alice', anonymous_label: 'Adult-1' },
  { real_name: 'Bob', anonymous_label: 'Child-1' },
  { real_name: 'Springfield Elementary', anonymous_label: 'School-1' },
  { real_name: 'Charlie', anonymous_label: 'Adult-2' }
];

export async function translateToAnonymous(text: string): Promise<string> {
  let translated = text;
  try {
    const { rows } = await pool.query('SELECT real_name, anonymous_label FROM entity_registry');
    const entities = rows.length > 0 ? rows : FALLBACK_ENTITIES;
    
    // Sort logic to avoid partial matches (e.g. replacing 'Rob' inside 'Robin')
    entities.sort((a, b) => b.real_name.length - a.real_name.length);

    for (const entity of entities) {
      // Use word boundaries \b to ensure exact matches
      const regex = new RegExp(`\\b${entity.real_name}\\b`, 'gi');
      translated = translated.replace(regex, entity.anonymous_label);
    }
  } catch (err) {
    console.error('Translation error:', err);
  }
  return translated;
}

export async function translateToReal(text: string): Promise<string> {
  let translated = text;
  try {
    const { rows } = await pool.query('SELECT real_name, anonymous_label FROM entity_registry');
    const entities = rows.length > 0 ? rows : FALLBACK_ENTITIES;
    
    entities.sort((a, b) => b.anonymous_label.length - a.anonymous_label.length);

    for (const entity of entities) {
      const regex = new RegExp(`\\b${entity.anonymous_label}\\b`, 'gi');
      // For reverse, we typically keep the casing of the real_name from the DB
      translated = translated.replace(regex, entity.real_name);
    }
  } catch (err) {
    console.error('Reverse translation error:', err);
  }
  return translated;
}
