import { cn } from "../lib/utils";
import { statusBadge, statusBadgeDefault } from "../lib/status-colors";

const statusDisplayLabels: Record<string, string> = {
  todo: "De facut",
  in_progress: "In progres",
  in_review: "In revizuire",
  done: "Finalizat",
  blocked: "Blocat",
  cancelled: "Anulat",
  backlog: "Backlog",
  terminated: "Terminat",
  active: "Activ",
  paused: "In pauza",
  succeeded: "Reusit",
  failed: "Esuat",
  timed_out: "Expirat",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0",
        statusBadge[status] ?? statusBadgeDefault
      )}
    >
      {statusDisplayLabels[status] ?? status.replace("_", " ")}
    </span>
  );
}
