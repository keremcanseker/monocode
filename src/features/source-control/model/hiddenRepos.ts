import { pathKey } from "../../../shared/lib/paths";

const KEY = "monocode.hiddenRepos";

/** Checkouts, relative to the project folder, keyed by project. */
function loadAll(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Checkouts left out of Repositories and every change count for this project. */
export function hiddenRepos(projectCwd: string): string[] {
  const list = loadAll()[pathKey(projectCwd)];
  return Array.isArray(list)
    ? list.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function setRepoHidden(
  projectCwd: string,
  relative: string,
  hidden: boolean,
) {
  const all = loadAll();
  const key = pathKey(projectCwd);
  const rest = hiddenRepos(projectCwd).filter((entry) => entry !== relative);
  const next = hidden ? [...rest, relative].sort() : rest;
  if (next.length) all[key] = next;
  else delete all[key];
  localStorage.setItem(KEY, JSON.stringify(all));
}
