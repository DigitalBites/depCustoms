"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ConfirmVariant = "default" | "destructive";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmDialogContext = createContext<ConfirmFn | null>(null);

export function ConfirmDialogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [queue, setQueue] = useState<ConfirmRequest[]>([]);
  const current = queue[0] ?? null;

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setQueue((prev) => [...prev, { ...options, resolve }]);
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    setQueue((prev) => {
      if (prev.length === 0) {
        return prev;
      }

      prev[0].resolve(value);
      return prev.slice(1);
    });
  }, []);

  const contextValue = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmDialogContext.Provider value={contextValue}>
      {children}
      <Dialog
        open={Boolean(current)}
        onOpenChange={(open) => {
          if (!open && current) {
            settle(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{current?.title}</DialogTitle>
            {current?.description ? (
              <DialogDescription>{current.description}</DialogDescription>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => settle(false)}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              {current?.cancelLabel ?? "Cancel"}
            </button>
            <button
              type="button"
              onClick={() => settle(true)}
              className={
                current?.variant === "destructive"
                  ? "rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:opacity-90"
                  : "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              }
            >
              {current?.confirmLabel ?? "Confirm"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const context = useContext(ConfirmDialogContext);
  if (!context) {
    throw new Error("useConfirm must be used within ConfirmDialogProvider");
  }
  return context;
}
