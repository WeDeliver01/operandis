import { ProductPortraitLayout } from "@/components/ProductPortraitLayout";
import ElegantCustomiseContent, { meta } from "@/content/products/elegant-customise.mdx";

export default function ElegantCustomiseProduct() {
  return (
    <ProductPortraitLayout meta={meta}>
      <ElegantCustomiseContent />
    </ProductPortraitLayout>
  );
}
