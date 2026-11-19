-- Portfolio: the-bread card is replaced by Delectables; WeShip now links to app.weship.co.za.
-- Data-only; fresh databases have no rows yet and get these values from the seed instead.
UPDATE portfolio_projects SET
  slug = 'delectables',
  title = 'Delectables',
  short_description = 'Gauteng''s bakery marketplace: order celebration cakes, breads and pastries from independent bakers, with a live-priced cake designer, group orders and next-day delivery.',
  industry = 'Food & eCommerce marketplace',
  project_type = 'Multi-vendor marketplace',
  stack = 'React · Vite · Node.js · Google Maps',
  technology_tags = '["React", "Vite", "Node.js", "Google Maps"]'::jsonb,
  thumbnail_url = '/screens/delectables-hero.png',
  hero_url = '/screens/delectables-hero.png',
  logo_url = '/logos/delectables.png',
  external_url = 'https://delectabless.co.za',
  updated_at = now()
WHERE slug = 'the-bread'
  AND NOT EXISTS (SELECT 1 FROM portfolio_projects WHERE slug = 'delectables');
--> statement-breakpoint
UPDATE portfolio_projects SET
  external_url = 'https://app.weship.co.za',
  logo_url = '/logos/weship.png',
  updated_at = now()
WHERE slug = 'weship';
