// Vehicles (Feature 4): find a wreck, scavenge + fit the missing parts, pour fuel,
// then drive. A vehicle's EXISTENCE and spawn point are DETERMINISTIC from the seed
// (like chests), so unmodified cars regenerate per visit and never bloat the save.
// The moment one is repaired, refueled, or driven, a Vehicle record is persisted on
// GameState.vehicles and overrides the deterministic default (position + condition).
// Pure logic only — the scene owns sprites, driving, run-over, and noise.

import { createRng } from "./rng";
import { CHUNK_TILES, TILE_SIZE } from "./constants";
import { biomeAt } from "./world/biomes";
import { roadTileInChunk } from "./world/roads";
import type { GameState, Vehicle } from "../shared/contracts";

export interface VehicleTypeDef {
  id: string;
  name: string;
  speedMult: number; // × PLAYER_SPEED while driving (cars are fast)
  scale: number; // sprite scale (parked + while driving)
  tint: number;
  partsMin: number; // how many components a wreck needs to run again
  partsMax: number;
}

export const VEHICLE_TYPES: Record<string, VehicleTypeDef> = {
  sedan: { id: "sedan", name: "Sedan", speedMult: 2.3, scale: 1.5, tint: 0x4a6fa5, partsMin: 2, partsMax: 3 },
  pickup: { id: "pickup", name: "Pickup", speedMult: 2.05, scale: 1.7, tint: 0x9c4a3a, partsMin: 3, partsMax: 4 },
  van: { id: "van", name: "Van", speedMult: 1.85, scale: 1.9, tint: 0xb6bac0, partsMin: 3, partsMax: 4 },
};

export const VEHICLE_TYPE_IDS = Object.keys(VEHICLE_TYPES);

/** Repairable components a wreck may be missing. Fuel is separate (Fuel Canister). */
export const CAR_PARTS = ["Engine Part", "Battery", "Spark Plug", "Tire"] as const;

export const FUEL_PER_CAN = 60; // 0–100 fuel restored per Fuel Canister poured
export const FUEL_MAX = 100;

export interface VehicleSpawn {
  gid: string;
  type: string;
  tx: number; // GLOBAL tile coords (always a road tile → guaranteed walkable)
  ty: number;
}

export function vehicleDef(type: string): VehicleTypeDef {
  return VEHICLE_TYPES[type] ?? VEHICLE_TYPES.sedan;
}

/** Deterministic, sparse vehicle spawns for a chunk (urban only; on road tiles). */
export function chunkVehicles(seed: string, cx: number, cy: number): VehicleSpawn[] {
  const biome = biomeAt(seed, cx, cy);
  if (!biome.urban) return []; // cars live on city streets, not in the deep woods
  const rng = createRng(`${seed}:veh:${cx}:${cy}`);
  if (!rng.chance(0.42)) return []; // most blocks have none — a runner is uncommon & precious
  const count = rng.chance(0.16) ? 2 : 1;
  const out: VehicleSpawn[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    const t = roadTileInChunk(seed, cx, cy, rng, used);
    if (!t) break;
    used.add(`${t.tx},${t.ty}`);
    const type = rng.pick(VEHICLE_TYPE_IDS);
    out.push({ gid: `${cx}_${cy}_v${i}`, type, tx: t.tx, ty: t.ty });
  }
  return out;
}

// (roadTileInChunk moved verbatim to ./world/roads — shared with set-pieces, U2.)

/** Which components this specific wreck is missing (deterministic per gid). */
function partNeeds(seed: string, gid: string, type: string): string[] {
  const def = vehicleDef(type);
  const rng = createRng(`${seed}:vehp:${gid}`);
  const n = rng.int(def.partsMin, def.partsMax);
  const pool = [...CAR_PARTS];
  const picks: string[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    picks.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]);
  }
  return picks;
}

/** The deterministic initial (unrepaired, empty-tank) live state for a spawn. */
export function initialVehicle(seed: string, sp: VehicleSpawn): Vehicle {
  return {
    gid: sp.gid,
    type: sp.type,
    x: (sp.tx + 0.5) * TILE_SIZE,
    y: (sp.ty + 0.5) * TILE_SIZE,
    fuel: 0,
    repaired: false,
    needs: partNeeds(seed, sp.gid, sp.type),
  };
}

/** Persisted override if the player has touched this vehicle, else the default. */
export function resolveVehicle(state: GameState, seed: string, sp: VehicleSpawn): Vehicle {
  return state.vehicles?.find((v) => v.gid === sp.gid) ?? initialVehicle(seed, sp);
}

export function findVehicle(state: GameState, gid: string): Vehicle | undefined {
  return state.vehicles?.find((v) => v.gid === gid);
}

/** Insert or replace a vehicle's persisted record (by gid). */
export function upsertVehicle(state: GameState, v: Vehicle): void {
  state.vehicles = state.vehicles ?? [];
  const i = state.vehicles.findIndex((x) => x.gid === v.gid);
  if (i >= 0) state.vehicles[i] = v;
  else state.vehicles.push(v);
}

/** Fit one needed part into the wreck (caller consumes the item). Marks it repaired
 *  once nothing is left to fix. Returns true if the part was applicable. */
export function fitPart(v: Vehicle, part: string): boolean {
  const i = v.needs.indexOf(part);
  if (i < 0) return false;
  v.needs.splice(i, 1);
  if (v.needs.length === 0) v.repaired = true;
  return true;
}

/** The next component this wreck needs (for the repair prompt), or null when done. */
export function nextNeed(v: Vehicle): string | null {
  return v.needs.length > 0 ? v.needs[0] : null;
}

export function isRepaired(v: Vehicle): boolean {
  return v.repaired && v.needs.length === 0;
}

export function isDrivable(v: Vehicle): boolean {
  return isRepaired(v) && v.fuel > 0;
}

/** Which chunk a vehicle currently sits in (its position may differ from its spawn). */
export function vehicleChunkOf(v: Vehicle): { cx: number; cy: number } {
  const CHUNK_PX = CHUNK_TILES * TILE_SIZE;
  return { cx: Math.floor(v.x / CHUNK_PX), cy: Math.floor(v.y / CHUNK_PX) };
}
