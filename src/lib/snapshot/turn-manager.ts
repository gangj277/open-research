import type { TreeHash, TurnSnapshot, SnapshotPatch, RevertRecord } from "./types";
import { SnapshotEngine } from "./engine";

/**
 * TurnManager coordinates snapshots at the agent-turn level.
 * It tracks before/after state for each turn and supports revert/unrevert.
 */
export class TurnManager {
  private engine: SnapshotEngine;
  private turnSnapshots: TurnSnapshot[] = [];
  private pendingBeforeHash: TreeHash | null = null;
  private pendingTurnIndex: number | null = null;
  private lastRevert: RevertRecord | null = null;

  constructor(workspaceDir: string) {
    this.engine = new SnapshotEngine(workspaceDir);
  }

  /** Initialize the snapshot engine. Call on workspace load. */
  async init(): Promise<void> {
    await this.engine.init();
  }

  /** Run garbage collection. Call on session start. */
  async gc(): Promise<void> {
    await this.engine.gc();
  }

  /**
   * Call before a turn starts. Takes a snapshot of the current state.
   */
  async beginTurn(turnIndex: number): Promise<void> {
    try {
      this.pendingBeforeHash = await this.engine.track();
      this.pendingTurnIndex = turnIndex;
    } catch {
      // Snapshot failed — degrade gracefully
      this.pendingBeforeHash = null;
      this.pendingTurnIndex = null;
    }
  }

  /**
   * Call after a turn ends. Takes a new snapshot and computes the patch.
   * Returns the TurnSnapshot, or null if snapshotting failed.
   */
  async endTurn(turnIndex: number): Promise<TurnSnapshot | null> {
    if (this.pendingBeforeHash === null || this.pendingTurnIndex !== turnIndex) {
      return null;
    }

    try {
      const afterHash = await this.engine.track();
      const patch = await this.engine.patch(this.pendingBeforeHash, afterHash);

      const snapshot: TurnSnapshot = {
        turnIndex,
        before: this.pendingBeforeHash,
        after: afterHash,
        patch,
        timestamp: new Date().toISOString(),
      };

      this.turnSnapshots.push(snapshot);
      this.pendingBeforeHash = null;
      this.pendingTurnIndex = null;

      return snapshot;
    } catch {
      this.pendingBeforeHash = null;
      this.pendingTurnIndex = null;
      return null;
    }
  }

  /**
   * Revert all changes made in turns with index > afterTurn.
   * Restores the workspace to the state after the specified turn completed.
   */
  async revertToTurn(afterTurn: number): Promise<RevertRecord & { filesRestored: string[] }> {
    // Find the target snapshot (the turn we're reverting TO)
    const targetSnapshot = this.turnSnapshots.find((s) => s.turnIndex === afterTurn);
    if (!targetSnapshot) {
      throw new Error(`No snapshot found for turn ${afterTurn}`);
    }

    // Collect all turns that will be reverted
    const turnsToRevert = this.turnSnapshots
      .filter((s) => s.turnIndex > afterTurn)
      .sort((a, b) => b.turnIndex - a.turnIndex); // newest first

    if (turnsToRevert.length === 0) {
      throw new Error("Nothing to revert");
    }

    // Take a snapshot of the current state (for unrevert)
    const preRevertSnapshot = await this.engine.track();

    // Collect all files that need to be restored
    const allPatches: SnapshotPatch = { added: [], modified: [], deleted: [] };
    for (const turn of turnsToRevert) {
      allPatches.added.push(...turn.patch.added);
      allPatches.modified.push(...turn.patch.modified);
      allPatches.deleted.push(...turn.patch.deleted);
    }

    // Deduplicate
    allPatches.added = [...new Set(allPatches.added)];
    allPatches.modified = [...new Set(allPatches.modified)];
    allPatches.deleted = [...new Set(allPatches.deleted)];

    // Remove from added/modified any files that are in both
    // (a file that was added then modified should just be treated as added)
    const modifiedSet = new Set(allPatches.modified);
    allPatches.added = allPatches.added.filter((f) => !modifiedSet.has(f));

    // Revert to the target snapshot
    const filesRestored = await this.engine.revert(targetSnapshot.after, allPatches);

    const record: RevertRecord = {
      preRevertSnapshot,
      revertedTurns: turnsToRevert.map((t) => t.turnIndex),
      targetSnapshot: targetSnapshot.after,
      timestamp: new Date().toISOString(),
    };

    this.lastRevert = record;

    return { ...record, filesRestored };
  }

  /**
   * Undo the last revert. Restores the workspace to pre-revert state.
   */
  async unrevert(): Promise<void> {
    if (!this.lastRevert) {
      throw new Error("Nothing to unrevert");
    }

    await this.engine.restore(this.lastRevert.preRevertSnapshot);
    this.lastRevert = null;
  }

  /** Get all recorded turn snapshots */
  getTurnSnapshots(): TurnSnapshot[] {
    return [...this.turnSnapshots];
  }

  /** Get the diff for a specific turn */
  async getTurnDiff(turnIndex: number): Promise<string> {
    const snapshot = this.turnSnapshots.find((s) => s.turnIndex === turnIndex);
    if (!snapshot) return "";
    return this.engine.diff(snapshot.before, snapshot.after);
  }

  /** Check if an unrevert is available */
  canUnrevert(): boolean {
    return this.lastRevert !== null;
  }

  /** Get the last revert record */
  getLastRevert(): RevertRecord | null {
    return this.lastRevert;
  }

  /**
   * Rehydrate turn snapshots from persisted session data.
   * Call when resuming a session.
   */
  rehydrate(snapshots: TurnSnapshot[]): void {
    this.turnSnapshots = [...snapshots];
  }

  /** Get the number of recorded turns */
  get turnCount(): number {
    return this.turnSnapshots.length;
  }
}
