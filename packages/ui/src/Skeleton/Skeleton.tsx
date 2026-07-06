import type { HTMLAttributes } from "react";
import styles from "./Skeleton.module.css";

export type SkeletonProps = HTMLAttributes<HTMLSpanElement>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={[styles.skeleton, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
