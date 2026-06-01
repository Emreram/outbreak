// Character skills & XP (Feature 9): you get better at what you do. XP is granted
// by the relevant actions (farming on harvest, crafting on craft, combat on kills,
// etc.) and levels drive small bonuses + progression. Pure logic on GameState.skills
// (a sparse xp-per-skill map, optional → old saves stay valid).

import type { GameState } from "../shared/contracts";

export const SKILLS = ["combat", "farming", "crafting", "medical", "fitness", "mechanics"] as const;
export type SkillId = (typeof SKILLS)[number];

export const SKILL_NAMES: Record<SkillId, string> = {
  combat: "Combat",
  farming: "Farming",
  crafting: "Crafting",
  medical: "Medical",
  fitness: "Fitness",
  mechanics: "Mechanics",
};
export const SKILL_ABBR: Record<SkillId, string> = {
  combat: "CMB",
  farming: "FRM",
  crafting: "CRF",
  medical: "MED",
  fitness: "FIT",
  mechanics: "MEC",
};

/** Total XP required to be AT a level: L1=0, L2=100, L3=300, L4=600 … (rising cost). */
export function xpForLevel(level: number): number {
  return (100 * (level - 1) * level) / 2;
}

export function levelFor(xp: number): number {
  let l = 1;
  while (xp >= xpForLevel(l + 1)) l++;
  return l;
}

export function skillXp(s: GameState, id: SkillId): number {
  return s.skills?.[id] ?? 0;
}

export function skillLevel(s: GameState, id: SkillId): number {
  return levelFor(skillXp(s, id));
}

/** Add XP to a skill. Returns the new level if it INCREASED (for a level-up cue), else 0. */
export function addXp(s: GameState, id: SkillId, amount: number): number {
  if (amount <= 0) return 0;
  s.skills = s.skills ?? {};
  const before = levelFor(s.skills[id] ?? 0);
  s.skills[id] = (s.skills[id] ?? 0) + amount;
  const after = levelFor(s.skills[id]);
  return after > before ? after : 0;
}
