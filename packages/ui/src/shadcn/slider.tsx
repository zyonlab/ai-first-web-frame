"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";
import { cn } from "./cn";

/**
 * Slider — vendored shadcn/ui over `@radix-ui/react-slider`, restyled to tokens
 * (doc 04 §3.1). Leverage slider in `order-form`. Token-backed utilities only.
 */

const Slider = forwardRef<
  ElementRef<typeof SliderPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className,
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-sm bg-surface-2">
      <SliderPrimitive.Range className="absolute h-full bg-accent" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-4 w-4 rounded-lg border border-accent bg-surface-1 shadow-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
  </SliderPrimitive.Root>
));
Slider.displayName = "Slider";

export { Slider };
