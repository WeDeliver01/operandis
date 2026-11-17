import { ProductPortraitLayout } from "@/components/ProductPortraitLayout";
import WeshipContent, { meta } from "@/content/products/weship.mdx";

export default function WeshipProduct() {
  return (
    <ProductPortraitLayout meta={meta}>
      <WeshipContent />
    </ProductPortraitLayout>
  );
}
