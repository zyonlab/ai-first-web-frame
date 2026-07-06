import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Card.module.css";

export type CardProps = HTMLAttributes<HTMLElement> & { children: ReactNode };

export function Card({ children, className, ...props }: CardProps) {
  return (
    <article
      className={[styles.card, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </article>
  );
}
