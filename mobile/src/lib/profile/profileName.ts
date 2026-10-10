/**
 * Profile name display — the single owner of the #804 nickname display rules.
 *
 * `Profile.nickname` is read from `profiles.nickname` (#863 data contract) and is
 * optional and separate from the unique username. Screens never read it directly;
 * they call one of the helpers below so the fallback policy lives in one place:
 *
 * - identification (profile header, @handle, URLs): nickname when set, otherwise the
 *   username — the account must stay tellable apart even before a nickname exists.
 * - mentions of the person in a sentence ("…님처럼", "…님을 팔로우했어요", home
 *   question cards): nickname when set, otherwise the user-confirmed `원픽 사용자`.
 */
type NamedProfile = { username: string; nickname?: string | null };

/** User-confirmed wording for a person without a nickname (#804). */
export const UNSET_NICKNAME_MENTION = '원픽 사용자';

export function profileNickname(profile: NamedProfile): string | null {
  const nickname = profile.nickname?.trim();
  return nickname ? nickname : null;
}

/** The name a profile header shows: nickname when set, otherwise the username (identification). */
export function profileDisplayName(profile: NamedProfile): string {
  return profileNickname(profile) ?? profile.username;
}

/** The name used when a sentence talks about the person: nickname, otherwise `원픽 사용자`. */
export function profileMentionName(profile: NamedProfile): string {
  return profileNickname(profile) ?? UNSET_NICKNAME_MENTION;
}

/** The @username line, only when it differs from the displayed name. */
export function profileHandle(profile: NamedProfile): string | null {
  return profileNickname(profile) ? `@${profile.username}` : null;
}
