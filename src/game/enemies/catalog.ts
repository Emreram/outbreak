import type { EnemyFamily, ZombieDef } from "./types";
import { ZOMBIES } from "./zombies";

// The zombie catalog: id -> def lookup + family pools. The engine rolls a specific
// def from here whenever it spawns one of the GM's broad families.

const BY_ID = new Map<string, ZombieDef>();
for (const z of ZOMBIES) BY_ID.set(z.id, z);

const BY_FAMILY = new Map<EnemyFamily, ZombieDef[]>();
for (const z of ZOMBIES) {
  const arr = BY_FAMILY.get(z.family);
  if (arr) arr.push(z);
  else BY_FAMILY.set(z.family, [z]);
}

export function getZombie(id: string): ZombieDef | undefined {
  return BY_ID.get(id);
}

export function allZombies(): readonly ZombieDef[] {
  return ZOMBIES;
}

export function familyPool(fam: EnemyFamily): ZombieDef[] {
  return BY_FAMILY.get(fam) ?? [];
}
