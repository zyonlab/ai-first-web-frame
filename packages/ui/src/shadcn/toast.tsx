"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";
import { cn } from "./cn";

/**
 * Toast — vendored shadcn/ui over `@radix-ui/react-toast`, restyled to tokens
 * (doc 04 §3.1). Order submit / fill / error notifications. Variants (`default`
 * / `success` / `error`) are `cva` token-class maps — no hard-coded colors.
 */

const ToastProvider = ToastPrimitive.Provider;

const ToastViewport = forwardRef<
  ElementRef<typeof ToastPrimitive.Viewport>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(
      "fixed bottom-0 right-0 z-modal flex max-h-screen w-full flex-col gap-sm p-md sm:max-w-sm",
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = "ToastViewport";

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between gap-md overflow-hidden rounded-md border p-md shadow-raised",
  {
    variants: {
      variant: {
        default: "border-border bg-surface-2 text-ink",
        success: "border-buy bg-surface-2 text-buy",
        error: "border-sell bg-surface-2 text-sell",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

const Toast = forwardRef<
  ElementRef<typeof ToastPrimitive.Root>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => (
  <ToastPrimitive.Root
    ref={ref}
    className={cn(toastVariants({ variant }), className)}
    {...props}
  />
));
Toast.displayName = "Toast";

const ToastTitle = forwardRef<
  ElementRef<typeof ToastPrimitive.Title>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title
    ref={ref}
    className={cn("text-sm font-semibold", className)}
    {...props}
  />
));
ToastTitle.displayName = "ToastTitle";

const ToastDescription = forwardRef<
  ElementRef<typeof ToastPrimitive.Description>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description
    ref={ref}
    className={cn("text-sm text-text-muted", className)}
    {...props}
  />
));
ToastDescription.displayName = "ToastDescription";

const ToastClose = forwardRef<
  ElementRef<typeof ToastPrimitive.Close>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    className={cn(
      "rounded-sm text-text-muted transition-colors hover:text-ink",
      className,
    )}
    aria-label="Close"
    {...props}
  >
    <span aria-hidden="true">×</span>
  </ToastPrimitive.Close>
));
ToastClose.displayName = "ToastClose";

export {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  toastVariants,
};
