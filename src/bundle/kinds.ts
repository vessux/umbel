export const ARTIFACT_KINDS = ["skills", "agents", "hooks", "mcps"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
