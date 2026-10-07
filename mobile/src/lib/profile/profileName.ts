/**
 * Profile name display (#757 structure, #804 nickname policy).
 *
 * The nickname is optional and separate from the unique username. Until #804 ships
 * nickname storage the read model leaves it undefined, so every profile shows its
 * username and no duplicate @username line. Once a nickname exists the profile shows
 * the nickname with the @username handle underneath.
 */
type NamedProfile = { username: string; nickname?: string | null };

export function profileNickname(profile: NamedProfile): string | null {
  const nickname = profile.nickname?.trim();
  return nickname ? nickname : null;
}

/** The name a profile header shows: nickname when set, otherwise the username. */
export function profileDisplayName(profile: NamedProfile): string {
  return profileNickname(profile) ?? profile.username;
}

/** The @username line, only when it differs from the displayed name. */
export function profileHandle(profile: NamedProfile): string | null {
  return profileNickname(profile) ? `@${profile.username}` : null;
}
