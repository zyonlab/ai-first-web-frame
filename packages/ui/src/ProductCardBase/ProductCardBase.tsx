import { Card } from "../Card";
import { Image } from "../Image";
import styles from "./ProductCardBase.module.css";

export type ProductCardBaseProps = {
  title: string;
  price: string;
  imageSrc: string;
  imageAlt: string;
  description?: string;
};

export function ProductCardBase({
  title,
  price,
  imageSrc,
  imageAlt,
  description,
}: ProductCardBaseProps) {
  return (
    <Card className={styles.card}>
      <Image src={imageSrc} alt={imageAlt} width={96} height={96} />
      <div>
        <h2 className={styles.title}>{title}</h2>
        <p>{description}</p>
        <strong className={styles.price}>{price}</strong>
      </div>
    </Card>
  );
}
