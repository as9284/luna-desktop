import path from 'node:path'

/**
 * Build the permanent protected denylist — locations no grant can ever re-open.
 * Pure: takes the machine's key directories as input so it's testable without Electron.
 *
 * Covers: OS/system dirs, credential + key stores, browser profiles, and — critically —
 * Luna's own app-data directory, which holds the encrypted API keys and the grant registry.
 * Luna must never be able to read or rewrite its own secrets.
 */
export function buildDenylist(dirs: { home: string; userData: string }): string[] {
  const { home, userData } = dirs
  const h = (...p: string[]) => path.join(home, ...p)

  const list = [
    userData, // Luna's safeStorage keys, atlas.db, grants.json — absolute no-go

    // credential & key stores (cross-platform)
    h('.ssh'),
    h('.aws'),
    h('.gnupg'),
    h('.gcloud'),
    h('.config', 'gcloud'),
    h('.kube'),
    h('.docker'),
    h('.netrc'),

    // browser profiles (cookies, saved passwords, session tokens)
    h('AppData', 'Local', 'Google', 'Chrome', 'User Data'),
    h('AppData', 'Local', 'Microsoft', 'Edge', 'User Data'),
    h('AppData', 'Roaming', 'Mozilla', 'Firefox'),
    h('Library', 'Application Support', 'Google', 'Chrome'),
    h('Library', 'Application Support', 'Firefox'),
    h('.mozilla'),
    h('.config', 'google-chrome'),

    // OS credential vaults
    h('AppData', 'Roaming', 'Microsoft', 'Credentials'),
    h('AppData', 'Roaming', 'Microsoft', 'Protect'),
    h('Library', 'Keychains'),
  ]

  if (process.platform === 'win32') {
    const sysRoot = process.env.SystemRoot || 'C:\\Windows'
    const sysDrive = process.env.SystemDrive || 'C:'
    list.push(
      sysRoot,
      path.join(sysDrive + path.sep, 'Program Files'),
      path.join(sysDrive + path.sep, 'Program Files (x86)'),
      path.join(sysDrive + path.sep, 'ProgramData'),
    )
  } else {
    list.push('/etc', '/var', '/usr', '/bin', '/sbin', '/System', '/private/etc')
  }

  return list
}
