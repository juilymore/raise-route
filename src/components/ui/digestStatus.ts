export const DIGEST_STATUS: Record<string, { label: string; cls: string; help: string }> = {
  SENT: { label: "Sent", cls: "bg-emerald-50 text-emerald-700", help: "The email provider confirmed it accepted the message (id recorded)." },
  PREVIEW: { label: "Preview (not sent)", cls: "bg-blue-50 text-blue-700", help: "Built from the run's snapshots but not sent." },
  SENDING: { label: "Sending", cls: "bg-blue-50 text-blue-700", help: "A send is in progress." },
  FAILED: { label: "Failed", cls: "bg-red-50 text-red-700", help: "The provider did not accept it. It can be retried; it is never shown as sent." },
  DEV_NOT_SENT: { label: "Not sent (no email key)", cls: "bg-orange-50 text-orange-800", help: "No email provider key or recipient is configured, so nothing was sent." },
};
