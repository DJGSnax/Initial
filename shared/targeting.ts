import type { TraitRule, UrlRule, Targeting } from "./types";

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

export function matchUrlRule(rule: UrlRule, path: string): boolean {
  const v = rule.value ?? "";
  switch (rule.op) {
    case "equals": {
      const norm = (x: string) => (x.length > 1 ? x.replace(/\/+$/, "") : x);
      return norm(path) === norm(v);
    }
    case "starts_with":
      return path.startsWith(v);
    case "contains":
      return path.includes(v);
    case "glob":
      return globToRegExp(v).test(path);
    case "regex":
      try {
        return new RegExp(v).test(path);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/** Empty include list matches everything. Any matching exclude rule wins. */
export function matchUrlRules(rules: UrlRule[], path: string): boolean {
  if (!rules?.length) return true;
  const includes = rules.filter((r) => !r.exclude);
  const excludes = rules.filter((r) => r.exclude);
  if (excludes.some((r) => matchUrlRule(r, path))) return false;
  return includes.length === 0 || includes.some((r) => matchUrlRule(r, path));
}

type Traits = Record<string, string | number | boolean | undefined>;

export function matchTraitRule(rule: TraitRule, traits: Traits): boolean {
  const actual = traits[rule.key];
  const expected = rule.value;
  switch (rule.op) {
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "not_exists":
      return actual === undefined || actual === null || actual === "";
    case "eq":
      return actual !== undefined && String(actual) === String(expected);
    case "neq":
      return actual === undefined || String(actual) !== String(expected);
    case "in":
      return Array.isArray(expected) && actual !== undefined && expected.map(String).includes(String(actual));
    case "not_in":
      return !Array.isArray(expected) || actual === undefined || !expected.map(String).includes(String(actual));
    case "gt":
      return actual !== undefined && Number(actual) > Number(expected);
    case "lt":
      return actual !== undefined && Number(actual) < Number(expected);
    default:
      return false;
  }
}

export function matchTargeting(t: Targeting, ctx: { path: string; traits: Traits; identified: boolean }): boolean {
  if (t.audience === "identified" && !ctx.identified) return false;
  if (t.audience === "anonymous" && ctx.identified) return false;
  if (!matchUrlRules(t.urlRules, ctx.path)) return false;
  return (t.traitRules ?? []).every((r) => matchTraitRule(r, ctx.traits));
}
