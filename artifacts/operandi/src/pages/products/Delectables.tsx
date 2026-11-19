import { ProductPortraitLayout } from "@/components/ProductPortraitLayout";
import DelectablesContent, { meta } from "@/content/products/delectables.mdx";

export default function DelectablesProduct() {
  return (
    <ProductPortraitLayout meta={meta}>
      <DelectablesContent />
    </ProductPortraitLayout>
  );
}
