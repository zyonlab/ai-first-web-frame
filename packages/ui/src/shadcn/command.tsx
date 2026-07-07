"use client";

import { Command as CommandPrimitive } from "cmdk";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";
import { cn } from "./cn";
import { Dialog, DialogContent } from "./dialog";

/**
 * Command / CommandPalette — vendored shadcn/ui over `cmdk`, restyled to tokens
 * (doc 04 §3.1). Symbol quick-switcher / command palette. Token-backed only.
 * `CommandDialog` wraps `cmdk` in the token-styled Dialog for the ⌘K palette.
 */

const Command = forwardRef<
  ElementRef<typeof CommandPrimitive>,
  ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-md border border-border bg-surface-2 text-ink",
      className,
    )}
    {...props}
  />
));
Command.displayName = "Command";

function CommandDialog({
  children,
  ...props
}: ComponentPropsWithoutRef<typeof Dialog>) {
  return (
    <Dialog {...props}>
      <DialogContent className="overflow-hidden p-0">
        <Command>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

const CommandInput = forwardRef<
  ElementRef<typeof CommandPrimitive.Input>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="flex items-center border-b border-border px-md">
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        "flex h-10 w-full bg-transparent py-md text-sm text-ink outline-none placeholder:text-text-muted",
        className,
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = "CommandInput";

const CommandList = forwardRef<
  ElementRef<typeof CommandPrimitive.List>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn("max-h-72 overflow-y-auto overflow-x-hidden", className)}
    {...props}
  />
));
CommandList.displayName = "CommandList";

const CommandEmpty = forwardRef<
  ElementRef<typeof CommandPrimitive.Empty>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="py-lg text-center text-sm text-text-muted"
    {...props}
  />
));
CommandEmpty.displayName = "CommandEmpty";

const CommandGroup = forwardRef<
  ElementRef<typeof CommandPrimitive.Group>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden p-xs text-ink [&_[cmdk-group-heading]]:px-sm [&_[cmdk-group-heading]]:py-xs [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-text-muted",
      className,
    )}
    {...props}
  />
));
CommandGroup.displayName = "CommandGroup";

const CommandItem = forwardRef<
  ElementRef<typeof CommandPrimitive.Item>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center gap-sm rounded-sm px-sm py-xs text-sm text-ink outline-none data-[selected=true]:bg-surface-1 data-[disabled=true]:pointer-events-none data-[disabled=true]:text-text-muted",
      className,
    )}
    {...props}
  />
));
CommandItem.displayName = "CommandItem";

const CommandSeparator = forwardRef<
  ElementRef<typeof CommandPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn("my-xs h-px bg-border", className)}
    {...props}
  />
));
CommandSeparator.displayName = "CommandSeparator";

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
};
