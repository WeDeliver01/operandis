import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConsentProvider } from "@/lib/consent";
import { ConsentBanner } from "@/components/ConsentBanner";
import { TagManager } from "@/components/TagManager";
import NotFound from "@/pages/not-found";

import Home from "@/pages/Home";
import Products from "@/pages/Products";
import Services from "@/pages/Services";
import Process from "@/pages/Process";
import About from "@/pages/About";
import Contact from "@/pages/Contact";
import Privacy from "@/pages/Privacy";
import Terms from "@/pages/Terms";
import Cookies from "@/pages/Cookies";

import TheBreadProduct from "@/pages/products/TheBread";
import WeshipProduct from "@/pages/products/Weship";
import DenexusProduct from "@/pages/products/Denexus";
import AirhouseProduct from "@/pages/products/Airhouse";
import ElegantCustomiseProduct from "@/pages/products/ElegantCustomise";
import RoutePlannerProduct from "@/pages/products/RoutePlanner";

const queryClient = new QueryClient();

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    if (window.location.hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location]);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/products" component={Products} />
      <Route path="/services" component={Services} />
      <Route path="/process" component={Process} />
      <Route path="/about" component={About} />
      <Route path="/contact" component={Contact} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/cookies" component={Cookies} />

      <Route path="/products/the-bread" component={TheBreadProduct} />
      <Route path="/products/weship" component={WeshipProduct} />
      <Route path="/products/denexus" component={DenexusProduct} />
      <Route path="/products/airhouse" component={AirhouseProduct} />
      <Route path="/products/elegant-customise" component={ElegantCustomiseProduct} />
      <Route path="/products/route-planner" component={RoutePlannerProduct} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ConsentProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <ScrollToTop />
            <Router />
          </WouterRouter>
          <TagManager />
          <ConsentBanner />
          <Toaster />
        </ConsentProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
