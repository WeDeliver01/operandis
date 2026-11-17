import { ProductPortraitLayout } from "@/components/ProductPortraitLayout";
import TheBreadContent, { meta } from "@/content/products/the-bread.mdx";

export default function TheBreadProduct() {
  return (
    <ProductPortraitLayout meta={meta}>
      <TheBreadContent />
    </ProductPortraitLayout>
  );
}
