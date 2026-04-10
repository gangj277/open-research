/** A git tree hash (40-char hex string) representing workspace state at a point in time */
export type TreeHash = string;

/** Describes which files changed between two snapshots */
export interface SnapshotPatch {
  added: string[];
  modified: string[];
  deleted: string[];
}

/** Records a snapshot pair for a single agent turn */
export interface TurnSnapshot {
  turnIndex: number;
  /** Tree hash before the turn started */
  before: TreeHash;
  /** Tree hash after the turn completed */
  after: TreeHash;
  /** Files changed during this turn */
  patch: SnapshotPatch;
  timestamp: string;
}

/** Records a revert operation so it can be undone */
export interface RevertRecord {
  /** Snapshot taken just before the revert (for unrevert) */
  preRevertSnapshot: TreeHash;
  /** Which turns were reverted */
  revertedTurns: number[];
  /** The target snapshot we restored to */
  targetSnapshot: TreeHash;
  timestamp: string;
}
