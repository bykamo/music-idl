"use client";

import {
  forwardRef,
  type HTMLAttributes,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false | Record<string, boolean>)[]) {
  return twMerge(clsx(inputs));
}

const springs = {
  moderate: { type: "spring" as const, duration: 0.3, bounce: 0.15 },
  slow: { type: "spring" as const, duration: 0.4, bounce: 0.2 },
};

const Dialog = DialogPrimitive.Root;
const DialogPortal = DialogPrimitive.Portal;

const DialogOverlay = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <div className="fixed inset-0 z-[101] flex items-center justify-center p-4">
      <DialogPrimitive.Content
        ref={ref}
        asChild
        {...props}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={springs.moderate}
          className={cn(
            "relative w-full max-w-[300px] border border-gray-800 bg-gray-950 p-4 text-gray-100 shadow-2xl rounded-xl space-y-2 focus:outline-none",
            className
          )}
        >
          {children}
        </motion.div>
      </DialogPrimitive.Content>
    </div>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight text-white",
      className
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-gray-400", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

import { Badge } from "./badge-2";
import { Button } from "./button-1";

export function LimitDialog({ 
  isOpen, 
  onClose, 
  title = "Batas Unduhan Tercapai", 
  description = "Anda telah mencapai batas maksimal 5 unduhan per hari. Silakan coba lagi besok." 
}: { 
  isOpen: boolean; 
  onClose: () => void;
  title?: string;
  description?: string;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[300px] w-[90%] max-w-[300px] border border-gray-800 bg-gray-950 p-5 text-gray-100 shadow-2xl rounded-xl space-y-3 relative">
        <button 
          onClick={onClose}
          className="absolute -top-3 -right-3 rounded-full bg-gray-900 border border-gray-800 p-1.5 hover:bg-gray-800 transition-colors shadow-lg z-10"
        >
            <X className="h-4 w-4 text-gray-400 hover:text-white" />
        </button>
        <p className="font-medium text-white">{title}</p>
        <p className="text-sm text-gray-400 leading-relaxed">{description}</p>
        
        <div className="flex items-center space-x-2 pt-1">
          <Badge variant="secondary" className="bg-red-900/30 text-red-400 border-red-900/50 text-[10px] px-1.5 py-0">
            Note!
          </Badge>
          <span className="text-[11px] text-gray-500">Kuota 5/5 telah terpenuhi hari ini.</span>
        </div>
        
        <div className="pt-3 flex justify-end">
          <Button onClick={onClose} className="bg-gray-800 hover:bg-gray-700 text-white text-xs px-4 py-1.5 h-auto">Mengerti</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
