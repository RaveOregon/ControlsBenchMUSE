import { allPlannedChecks, PLAN_GROUPS, QUALIFICATION_CHECKS } from "../../ui/src/model/plan.ts";

const categories = [...PLAN_GROUPS.map(g => g.id), "evidence"];

/** The portal sends check IDs. Partial groups must not expand into whole-category authority. */
export function resolveWonderScope(scope: Record<string, boolean>) {
  const keys = Object.keys(scope);
  if (!keys.length) return { categories, qualificationReferences: [] as string[] };
  if (keys.every(key => categories.includes(key))) {
    const selected = keys.filter(key => scope[key] === true);
    if (!selected.length) throw new Error("Select at least one Wonder campaign category");
    return { categories: selected, qualificationReferences: [] as string[] };
  }
  const planned = allPlannedChecks();
  const known = new Set(planned.map(c => c.id));
  if (keys.some(key => !known.has(key))) throw new Error("Wonder scope contains unknown check IDs or mixes categories and checks");
  const qualification = new Set(QUALIFICATION_CHECKS.map(c => c.id));
  const selected: string[] = [];
  for (const category of categories) {
    const checks = planned.filter(c => c.group === category && !qualification.has(c.id));
    const included = checks.filter(c => scope[c.id] === true);
    if (included.length && included.length !== checks.length)
      throw new Error(`Wonder currently accepts complete engineering groups: ${category} has individually deselected checks. Select or deselect the whole group.`);
    if (included.length) selected.push(category);
  }
  if (!selected.length) throw new Error("Select at least one supported Wonder campaign group; qualification references alone cannot authorize a campaign");
  return { categories: selected, qualificationReferences: [...qualification].filter(id => scope[id] === true) };
}
