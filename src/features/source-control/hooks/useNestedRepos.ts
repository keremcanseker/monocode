import { useCallback, useSyncExternalStore } from "react";
import {
  gitNestedRepos,
  subscribeGitChanged,
  type GitNestedRepo,
} from "../../../platform/tauri/fs";
import { joinPath } from "../../../shared/lib/paths";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { hiddenRepos } from "../model/hiddenRepos";
import { refreshProjectDiffStats } from "./useProjectDiffStats";

export type NestedRepo = GitNestedRepo & { path: string };

/** Picks up repos cloned, and changes made, in checkouts the pane is not showing. */
const POLL_MS = 5000;
const NONE: NestedRepo[] = [];

type Entry = {
  repos: NestedRepo[];
  scanned: boolean;
  inFlight: boolean;
  listeners: Set<() => void>;
  stop: (() => void) | null;
};

const entries = new Map<string, Entry>();

function entryFor(cwd: string): Entry {
  const existing = entries.get(cwd);
  if (existing) return existing;
  const entry: Entry = {
    repos: NONE,
    scanned: false,
    inFlight: false,
    listeners: new Set(),
    stop: null,
  };
  entries.set(cwd, entry);
  return entry;
}

function sameRepos(a: NestedRepo[], b: NestedRepo[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (repo, i) =>
        repo.path === b[i].path &&
        repo.branch === b[i].branch &&
        repo.files === b[i].files &&
        repo.upstream === b[i].upstream &&
        repo.ahead === b[i].ahead &&
        repo.behind === b[i].behind,
    )
  );
}

async function load(cwd: string, entry: Entry, force = false) {
  if (entry.inFlight || (!force && document.hidden)) return;
  entry.inFlight = true;
  try {
    const repos = (await gitNestedRepos(cwd, hiddenRepos(cwd))).map((repo) => ({
      ...repo,
      path: repo.relative ? joinPath(cwd, repo.relative) : cwd,
    }));
    entry.scanned = true;
    if (sameRepos(entry.repos, repos)) return;
    const hadNested = entry.repos.some((repo) => repo.relative);
    entry.repos = repos;
    // The Changes pane may have pushed this folder's own count before the scan
    // showed it holds other checkouts; re-read the summed stats.
    if (!hadNested && repos.some((repo) => repo.relative)) {
      refreshProjectDiffStats(cwd);
    }
    for (const listener of entry.listeners) listener();
  } catch {
    // Keep the last scan; one failed poll should not empty the list.
  } finally {
    entry.inFlight = false;
  }
}

function watchable(cwd: string): boolean {
  return Boolean(cwd) && cwd !== "~" && !isRemoteProjectPath(cwd);
}

/** Last scan of `cwd`, empty until one has run. */
export function cachedNestedRepos(cwd: string): NestedRepo[] {
  return entries.get(cwd)?.repos ?? NONE;
}

/** Scans once if nothing has; the Changes pane keeps the list fresh after that. */
export async function knownNestedRepos(cwd: string): Promise<NestedRepo[]> {
  if (!watchable(cwd)) return NONE;
  const entry = entryFor(cwd);
  if (!entry.scanned) await load(cwd, entry, true);
  return entry.repos;
}

/** Checkouts at or below `cwd` with their branch and changed-file count. */
export function useNestedRepos(cwd: string, enabled: boolean): NestedRepo[] {
  const active = enabled && watchable(cwd);
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!active) return () => undefined;
      const entry = entryFor(cwd);
      entry.listeners.add(listener);
      if (entry.listeners.size === 1) {
        const refresh = () => void load(cwd, entry);
        void load(cwd, entry, true);
        const timer = window.setInterval(refresh, POLL_MS);
        const unsubscribeGit = subscribeGitChanged(refresh);
        window.addEventListener("focus", refresh);
        entry.stop = () => {
          window.clearInterval(timer);
          unsubscribeGit();
          window.removeEventListener("focus", refresh);
        };
      }
      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0) {
          entry.stop?.();
          entry.stop = null;
        }
      };
    },
    [active, cwd],
  );
  const getSnapshot = useCallback(
    () => (active ? entryFor(cwd).repos : NONE),
    [active, cwd],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
