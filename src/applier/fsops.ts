import { mkdirSync, renameSync, symlinkSync, unlinkSync } from "node:fs";

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function symlinkAbsolute(source: string, target: string): void {
  // Absolute link (spec: source realpath resolved once at scan time).
  symlinkSync(source, target);
}

export function unlinkPath(path: string): void {
  unlinkSync(path);
}

export function moveToBackup(from: string, to: string): void {
  renameSync(from, to);
}
