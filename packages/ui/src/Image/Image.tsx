import type { ImgHTMLAttributes } from "react";
import styles from "./Image.module.css";

export type ImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  fallbackAlt?: string;
};

export function Image({
  alt,
  fallbackAlt = "Product image",
  className,
  ...props
}: ImageProps) {
  return (
    <img
      alt={alt || fallbackAlt}
      className={[styles.image, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
