export const RUN_STATUS: Record<string, { label: string; cls: string }> = {
  COMPLETED: { label: "Completed", cls: "bg-emerald-50 text-emerald-700" },
  COMPLETED_WITH_ERRORS: { label: "Completed with errors", cls: "bg-orange-50 text-orange-800" },
  RUNNING: { label: "Running", cls: "bg-blue-50 text-blue-700" },
  FAILED: { label: "Failed", cls: "bg-red-50 text-red-700" },
  CANCELLED: { label: "Cancelled", cls: "bg-gray-100 text-gray-600" },
};
