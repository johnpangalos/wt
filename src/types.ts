export type Worktree = {
  path: string;
  head: string;
  branch: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
};
