import { ProductPortraitLayout } from "@/components/ProductPortraitLayout";
import RoutePlannerContent, { meta } from "@/content/products/route-planner.mdx";

export default function RoutePlannerProduct() {
  return (
    <ProductPortraitLayout meta={meta}>
      <RoutePlannerContent />
    </ProductPortraitLayout>
  );
}
