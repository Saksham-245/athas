type PermissionResolver = (approved: boolean) => void;

const pending = new Map<string, PermissionResolver>();

export function registerHttpPermissionRequest(
  requestId: string,
  resolve: PermissionResolver,
): void {
  pending.set(requestId, resolve);
}

export function resolveHttpPermissionRequest(requestId: string, approved: boolean): boolean {
  const resolver = pending.get(requestId);
  if (!resolver) return false;
  pending.delete(requestId);
  resolver(approved);
  return true;
}

export function clearHttpPermissionRequests(approve = false): void {
  for (const [requestId, resolver] of pending.entries()) {
    pending.delete(requestId);
    resolver(approve);
  }
}
