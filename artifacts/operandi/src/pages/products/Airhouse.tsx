import { ProductPortraitLayout } from "@/components/ProductPortraitLayout";
import AirhouseContent, { meta } from "@/content/products/airhouse.mdx";

export default function AirhouseProduct() {
  return (
    <ProductPortraitLayout meta={meta}>
      <AirhouseContent />
    </ProductPortraitLayout>
  );
}
