import { useState } from "react";
import { ChevronDown, ChevronRight, Loader } from "../../../shared/ui/icons";
import { prettyCwd, projectName } from "../../../shared/lib/paths";
import {
  basename,
  gitPull,
  notifyGitChanged,
  revealPath,
} from "../../../platform/tauri/fs";
import { invalidateWatchedFiles } from "../../files/model/fileWatch";
import {
  ExplorerMenu,
  type ExplorerMenuItem,
} from "../../files/ui/ExplorerMenu";
import { copyText, REVEAL_LABEL } from "../../files/ui/FileTree";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import type { NestedRepo } from "../hooks/useNestedRepos";

let reposOpen = true;
let hiddenOpen = false;

type RepoMenu = { x: number; y: number; repo: NestedRepo; hidden: boolean };

/** VS Code's Repositories view: every checkout in the project folder, one selected. */
export function RepositoriesSection({
  projectCwd,
  repos,
  hidden,
  selected,
  onSelect,
  onHiddenChange,
  onOpenTerminal,
}: {
  projectCwd: string;
  repos: NestedRepo[];
  /** Relative paths left out of the list and every change count. */
  hidden: string[];
  selected: string;
  onSelect: (path: string) => void;
  onHiddenChange: (relative: string, hidden: boolean) => void;
  onOpenTerminal?: (cwd: string) => void;
}) {
  const [open, setOpen] = useState(reposOpen);
  const [showHidden, setShowHidden] = useState(hiddenOpen);
  const [menu, setMenu] = useState<RepoMenu | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);
  const shown = repos.filter((repo) => !hidden.includes(repo.relative));
  const tucked = repos.filter((repo) => hidden.includes(repo.relative));
  const changed = shown.reduce((sum, repo) => sum + repo.files, 0);

  const pull = async (repo: NestedRepo) => {
    setPulling(repo.path);
    try {
      await gitPull(repo.path);
      notifyGitChanged();
      invalidateWatchedFiles();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      setPulling(null);
    }
  };

  const onPick = (id: string) => {
    if (!menu) return;
    const { repo } = menu;
    setMenu(null);
    switch (id) {
      case "pull":
        void pull(repo);
        return;
      case "open-terminal":
        onOpenTerminal?.(repo.path);
        return;
      case "reveal":
        void revealPath(repo.path).catch((error: unknown) =>
          window.alert(error instanceof Error ? error.message : String(error)),
        );
        return;
      case "copy-path":
        void copyText(repo.path);
        return;
      case "hide":
      case "show":
        onHiddenChange(repo.relative, id === "hide");
        return;
    }
  };

  const row = (repo: NestedRepo, isHidden: boolean) => {
    const active = !isHidden && repo.path === selected;
    return (
      <li key={repo.path}>
        <button
          type="button"
          title={isHidden ? "Show in Repositories" : prettyCwd(repo.path)}
          aria-current={active || undefined}
          onClick={() =>
            isHidden ? onHiddenChange(repo.relative, false) : onSelect(repo.path)
          }
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenu({
              x: event.clientX,
              y: event.clientY,
              repo,
              hidden: isHidden,
            });
          }}
          className={`flex h-7 w-full items-center gap-1.5 pr-2 pl-2 text-left leading-none ${
            active
              ? "bg-selection text-content"
              : "text-content hover:bg-content/5"
          } ${isHidden ? "opacity-50" : ""}`}
        >
          <FileTypeIcon name={basename(repo.path)} isDir size={16} />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-[13px] font-medium">
              {repo.relative || projectName(projectCwd)}
            </span>
            {repo.branch ? (
              <span className="ml-1.5 text-[11px] text-content/40">
                {repo.branch}
              </span>
            ) : null}
          </span>
          {pulling === repo.path ? (
            <Loader
              className="size-3.5 shrink-0 animate-spin text-content/50"
              strokeWidth={1.75}
            />
          ) : null}
          {repo.ahead > 0 ? (
            <span className="shrink-0 text-[11px] tabular-nums text-content/40">
              ↑{repo.ahead}
            </span>
          ) : null}
          {repo.behind > 0 ? (
            <span className="shrink-0 text-[11px] tabular-nums text-content/40">
              ↓{repo.behind}
            </span>
          ) : null}
          {repo.files > 0 ? (
            <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-accent/80 px-1 text-[8px] text-white">
              {repo.files}
            </span>
          ) : null}
        </button>
      </li>
    );
  };

  return (
    <div className="shrink-0 border-b border-stroke pb-1">
      <div className="flex h-7 items-center gap-1 px-1.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            reposOpen = !open;
            setOpen(reposOpen);
          }}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
        >
          {open ? (
            <ChevronDown
              className="size-3.5 shrink-0 text-content/50"
              strokeWidth={1.75}
            />
          ) : (
            <ChevronRight
              className="size-3.5 shrink-0 text-content/50"
              strokeWidth={1.75}
            />
          )}
          <span className="min-w-0 truncate text-[10px] font-semibold tracking-[0.04em] text-content/55 uppercase">
            Repositories
          </span>
          {changed > 0 ? (
            <span className="ml-1 grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-accent/80 px-1 text-[8px] text-white">
              {changed}
            </span>
          ) : null}
        </button>
      </div>
      {open ? (
        <ul className="max-h-48 overflow-y-auto">
          {shown.map((repo) => row(repo, false))}
          {tucked.length ? (
            <li>
              <button
                type="button"
                aria-expanded={showHidden}
                onClick={() => {
                  hiddenOpen = !showHidden;
                  setShowHidden(hiddenOpen);
                }}
                className="flex h-7 w-full items-center gap-1 pl-2 text-left text-[11px] text-content/40 hover:text-content/70"
              >
                {showHidden ? (
                  <ChevronDown className="size-3.5 shrink-0" strokeWidth={1.75} />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0" strokeWidth={1.75} />
                )}
                {tucked.length} hidden
              </button>
            </li>
          ) : null}
          {tucked.length && showHidden
            ? tucked.map((repo) => row(repo, true))
            : null}
        </ul>
      ) : null}
      {menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(
            menu.repo,
            menu.hidden,
            Boolean(onOpenTerminal),
            pulling !== null,
          )}
          ariaLabel="Repository actions"
          onPick={onPick}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

function menuItems(
  repo: NestedRepo,
  hidden: boolean,
  canOpenTerminal: boolean,
  pulling: boolean,
): ExplorerMenuItem[] {
  const items: ExplorerMenuItem[] = [];
  if (!hidden) {
    items.push(
      {
        kind: "item",
        id: "pull",
        label: "Pull",
        disabled: !repo.upstream || pulling,
      },
      { kind: "sep" },
    );
  }
  if (canOpenTerminal) {
    items.push({ kind: "item", id: "open-terminal", label: "Open in Terminal" });
  }
  items.push(
    { kind: "item", id: "reveal", label: REVEAL_LABEL },
    { kind: "item", id: "copy-path", label: "Copy Path" },
  );
  // The project folder itself stays listed; only checkouts below it hide.
  if (repo.relative) {
    items.push(
      { kind: "sep" },
      hidden
        ? { kind: "item", id: "show", label: "Show in Repositories" }
        : { kind: "item", id: "hide", label: "Hide from Repositories" },
    );
  }
  return items;
}
