import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Section.module.css";

export type SectionProps = HTMLAttributes<HTMLElement> & {
  heading: string;
  children: ReactNode;
};

export function Section({
  heading,
  children,
  className,
  ...props
}: SectionProps) {
  return (
    <section
      className={[styles.section, className].filter(Boolean).join(" ")}
      {...props}
    >
      <h2 className={styles.heading}>{heading}</h2>
      {children}
    </section>
  );
}
