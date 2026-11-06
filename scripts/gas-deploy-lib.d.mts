export interface GasTarget {
  label: string;
  scriptId: string;
  deploymentId: string;
  files: string[];
  expectedVersion(): string;
}
export const TARGETS: { writing: GasTarget; classroom: GasTarget };
export function webAppUrl(deploymentId: string): string;
export function classroomVersion(source: string): string;
export function sameManifest(a: string, b: string): boolean;
export function sameCode(localSources: string[], remoteSources: string[]): boolean;
export function reportedVersion(target: 'writing' | 'classroom', body: unknown): string | undefined;
