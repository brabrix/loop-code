export function validateRemoteProfile(p) {
  if (!p || !p.host || !p.host.trim()) return { ok: false, error: 'remote.err_host' };
  if (!p.user || !p.user.trim()) return { ok: false, error: 'remote.err_user' };
  if (!p.remoteDir || !p.remoteDir.trim()) return { ok: false, error: 'remote.err_remotedir' };
  if (p.authType === 'key' && !(p.keyPath && p.keyPath.trim())) {
    return { ok: false, error: 'remote.err_keypath' };
  }
  return { ok: true };
}
