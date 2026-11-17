import { useEffect } from "react";
import { getCalApi } from "@calcom/embed-react";
import { CAL_LINK, CAL_NAMESPACE } from "@/lib/cal";
import { usePublicSettings } from "@/lib/settings";

interface BookCallButtonProps {
  variant?: "primary" | "secondary";
  children?: React.ReactNode;
  className?: string;
}

export function BookCallButton({ variant = "primary", children, className }: BookCallButtonProps) {
  const calLink = usePublicSettings().business.calLink || CAL_LINK;
  useEffect(() => {
    (async () => {
      const cal = await getCalApi({ namespace: CAL_NAMESPACE });
      cal("ui", {
        hideEventTypeDetails: false,
        layout: "month_view",
        theme: "light",
      });
    })();
  }, []);

  const baseClasses =
    "inline-block text-[14px] font-medium uppercase tracking-wider px-6 py-3 transition-colors duration-150 rounded-sm cursor-pointer";
  const primaryClasses = "bg-ink text-paper hover:bg-accent";
  const secondaryClasses = "border border-ink text-ink hover:bg-ink hover:text-paper";

  return (
    <button
      type="button"
      data-cal-namespace={CAL_NAMESPACE}
      data-cal-link={calLink}
      data-cal-config='{"layout":"month_view"}'
      className={
        className ??
        `${baseClasses} ${variant === "primary" ? primaryClasses : secondaryClasses}`
      }
    >
      {children ?? "Book a call"}
    </button>
  );
}
