import { useState } from "react";
import type { HarnessId } from "../../sessions/model/session";
import {
  notifyGitChanged,
  type GitFileDiffKind,
  type GitHistoryCommit,
} from "../../../platform/tauri/fs";
import { displayPath, joinPath } from "../../../shared/lib/paths";
import { sameProjectPath } from "../../projects/model/recents";
import { useNestedRepos, type NestedRepo } from "../hooks/useNestedRepos";
import { hiddenRepos, setRepoHidden } from "../model/hiddenRepos";
import { GitChangesPanel } from "./GitChangesPanel";
import { RepositoriesSection } from "./RepositoriesSection";

/** Repo picked in the Repositories section, per project folder. */
const pickedRepos = new Map<string, string>();

type Props = {
  cwd: string;
  /** The opened folder; checkouts below it are listed under Repositories. */
  projectCwd: string;
  enabled: boolean;
  textHarness?: HarnessId;
  selectedPath?: string;
  selectedKind?: GitFileDiffKind;
  selectedSha?: string;
  /** `repoCwd` is set when the file belongs to a checkout below the project. */
  onOpenFile: (
    path: string,
    kind: GitFileDiffKind,
    pin?: boolean,
    repoCwd?: string,
  ) => void;
  onOpenAllChanges: (repoCwd?: string) => void;
  onOpenCommit: (
    commit: GitHistoryCommit,
    pin?: boolean,
    repoCwd?: string,
  ) => void;
  onOpenTerminal?: (cwd: string) => void;
};

export function SourceControl({
  cwd,
  projectCwd,
  enabled,
  textHarness,
  selectedPath,
  selectedKind,
  selectedSha,
  onOpenFile,
  onOpenAllChanges,
  onOpenCommit,
  onOpenTerminal,
}: Props) {
  // A session in its own worktree keeps it; the list steers the project folder.
  const repos = useNestedRepos(
    projectCwd,
    enabled && sameProjectPath(cwd, projectCwd),
  );
  const [, rerender] = useState(0);
  const nested = repos.some((repo) => repo.relative);
  const hidden = hiddenRepos(projectCwd);
  const repoCwd = chooseRepo(
    repos.filter((repo) => !hidden.includes(repo.relative)),
    pickedRepos.get(projectCwd),
    cwd,
  );
  const repo = repoCwd === cwd ? undefined : repoCwd;
  const selected =
    repo && selectedPath
      ? displayPath(joinPath(cwd, selectedPath), repo)
      : selectedPath;
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <GitChangesPanel
        key={repoCwd}
        cwd={repoCwd}
        enabled={enabled}
        textHarness={textHarness}
        selectedPath={selected}
        selectedKind={selectedKind}
        selectedSha={selectedSha}
        repositories={
          nested ? (
            <RepositoriesSection
              projectCwd={projectCwd}
              repos={repos}
              hidden={hidden}
              selected={repo ?? projectCwd}
              onSelect={(path) => {
                pickedRepos.set(projectCwd, path);
                rerender((n) => n + 1);
              }}
              onHiddenChange={(relative, next) => {
                setRepoHidden(projectCwd, relative, next);
                rerender((n) => n + 1);
                // Badges, explorer colors and the list all re-read without it.
                notifyGitChanged();
              }}
              onOpenTerminal={onOpenTerminal}
            />
          ) : null
        }
        onOpenFile={(path, kind, pin) => onOpenFile(path, kind, pin, repo)}
        onOpenAllChanges={() => onOpenAllChanges(repo)}
        onOpenCommit={(commit, pin) => onOpenCommit(commit, pin, repo)}
      />
    </div>
  );
}

/** The picked checkout, else the project folder when it is one, else the first below it. */
function chooseRepo(
  repos: NestedRepo[],
  picked: string | undefined,
  cwd: string,
): string {
  if (!repos.some((repo) => repo.relative)) return cwd;
  const repo = repos.find((entry) => entry.path === picked) ?? repos[0];
  return repo.relative ? repo.path : cwd;
}
