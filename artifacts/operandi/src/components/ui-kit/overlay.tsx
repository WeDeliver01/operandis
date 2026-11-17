import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Btn } from "./index";

export function Modal({ open, onOpenChange, title, description, children, footer, wide }: { open: boolean; onOpenChange: (v: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-ink/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={`fixed z-[90] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-32px)] ${wide ? "max-w-[760px]" : "max-w-[520px]"} max-h-[calc(100vh-48px)] overflow-y-auto bg-paper border hairline rounded-sm shadow-ambient focus:outline-none`}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-6">
            <div>
              <Dialog.Title className="font-serif text-[22px] text-ink">{title}</Dialog.Title>
              {description ? <Dialog.Description className="text-[14px] text-muted mt-1">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</Dialog.Description>}
            </div>
            <Dialog.Close className="p-1 text-faint hover:text-ink" aria-label="Close">
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="px-6 py-5">{children}</div>
          {footer && <div className="px-6 pb-6 flex flex-wrap justify-end gap-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Confirmation for irreversible actions. */
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  variant = "secondary",
  danger,
  size = "sm",
  disabled,
  requireReason,
}: {
  children: ReactNode;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  onConfirm: (reason: string) => Promise<unknown> | unknown;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  danger?: boolean;
  size?: "sm" | "md";
  disabled?: boolean;
  requireReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Btn variant={variant} size={size} disabled={disabled} onClick={() => setOpen(true)}>
        {children}
      </Btn>
      <Modal
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          setError(null);
        }}
        title={title}
        description={description}
        footer={
          <>
            <Btn variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Btn>
            <Btn
              variant={danger ? "danger" : "primary"}
              size="sm"
              loading={busy}
              disabled={Boolean(requireReason) && reason.trim().length < 5}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await onConfirm(reason.trim());
                  setOpen(false);
                  setReason("");
                } catch (e) {
                  const { errorMessage } = await import("@/lib/api");
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmLabel}
            </Btn>
          </>
        }
      >
        {requireReason && (
          <label className="block">
            <span className="text-[13px] font-medium text-ink">{requireReason}</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-1.5 w-full bg-white border border-rule rounded-sm px-3 py-2 text-[14px] focus:outline-none focus:border-ink" />
          </label>
        )}
        {error && (
          <p role="alert" className="text-[13px] text-[#9F1D1D] mt-3">
            {error}
          </p>
        )}
      </Modal>
    </>
  );
}
