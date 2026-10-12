/**
 * The ONE place the app's name lives. Used by the logo, page title, browser tab,
 * favicon (src/app/icon.svg draws the glyph) and email digests.
 * Change it here and nowhere else.
 * The company name (the founder's startup) is NOT here: it lives in the
 * company_profile table and is edited in Settings.
 */
export const BRAND = {
  name: "RaiseRoute",
  tagline: "Your fundraising route, mapped",
  /** e.g. "RaiseRoute · Mon 12 Oct · 3 to reach out" */
  digestSubjectPrefix: "RaiseRoute",
  /** Display name for the digest "From" header. The address stays in DIGEST_FROM / Resend. */
  emailFromName: "RaiseRoute",
} as const;

/** Logo subtitle: the app tagline for the founder's company (name comes from company_profile). */
export const taglineFor = (company: string) => `Fundraising route mapped for ${company}`;

export const pageTitle = (page?: string) => (page ? `${page} · ${BRAND.name}` : `${BRAND.name} — ${BRAND.tagline}`);
