export const DIGEST_STATUS: Record<string, { label: string; cls: string; help: string }> = {
  SENT: { label: "Sent", cls: "bg-emerald-50 text-emerald-700", help: "The email service accepted it for delivery (it recorded a message id). Check your inbox and spam folder." },
  PREVIEW: { label: "Preview only", cls: "bg-blue-50 text-blue-700", help: "This is what the email looks like. It has not been emailed to anyone yet." },
  SENDING: { label: "Sending…", cls: "bg-blue-50 text-blue-700", help: "Being sent right now." },
  FAILED: { label: "Not delivered", cls: "bg-red-50 text-red-700", help: "The email service refused it, so nothing arrived in anyone's inbox. You can press the send button again." },
  DEV_NOT_SENT: { label: "Not sent (email not set up)", cls: "bg-orange-50 text-orange-800", help: "No email service key or recipient is set up, so nothing was sent." },
};

/** Turn the email provider's raw error into a sentence a person can act on. */
export function friendlyDigestError(error: string | null): string | null {
  if (!error) return null;
  if (/only send testing emails/i.test(error)) return "The free email plan can only deliver to the owner of the email account. The digest was addressed to a different address. It has now been pointed at the owner's address; press send again.";
  if (/api key|unauthor/i.test(error)) return "The email service key was rejected.";
  return error.length > 160 ? `${error.slice(0, 160)}…` : error;
}
