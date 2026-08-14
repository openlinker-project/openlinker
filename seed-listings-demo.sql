-- Seed data for visual verification of the redesigned /listings page (epic #2023)
-- against the #1965 mockup. Not a migration — throwaway data for a scratch stack.

BEGIN;

-- Connections
INSERT INTO connections (id, "platformType", name, status, config, "credentialsRef", "enabledCapabilities")
VALUES
  ('11111111-1111-1111-1111-111111111111', 'allegro', 'Allegro - Main Store', 'active', '{}'::jsonb, 'test-ref-1', '["OfferManager","OrderSource"]'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'erli', 'Erli - Sandbox', 'active', '{}'::jsonb, 'test-ref-2', '["OfferManager"]'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'prestashop', 'PrestaShop - Master Catalog', 'active', '{}'::jsonb, 'test-ref-3', '["ProductMaster","InventoryMaster"]'::jsonb);

-- Products + variants (simple products, one variant each)
INSERT INTO products (id, name, sku, price, currency, images) VALUES
  ('ol_product_seed01', 'Wireless Mechanical Keyboard RGB', 'KBD-RGB-01', 349.00, 'PLN', '[]'::jsonb),
  ('ol_product_seed02', 'Ergonomic Vertical Mouse', 'MOU-ERG-02', 129.00, 'PLN', '[]'::jsonb),
  ('ol_product_seed03', 'USB-C Docking Station 12-in-1', 'DOC-USBC-03', 459.00, 'PLN', '[]'::jsonb),
  ('ol_product_seed04', 'Noise-Cancelling Headphones Pro', 'HP-NC-04', 899.00, 'PLN', '[]'::jsonb),
  ('ol_product_seed05', '27" 4K Monitor IPS', 'MON-4K-05', 1699.00, 'PLN', '[]'::jsonb),
  ('ol_product_seed06', 'Mechanical Numpad Compact', 'NUM-COMP-06', 149.00, 'PLN', '[]'::jsonb),
  ('ol_product_seed07', 'Webcam 1080p with Ring Light', 'CAM-1080-07', 219.00, 'PLN', '[]'::jsonb),
  ('ol_product_seed08', 'Laptop Stand Aluminum Adjustable', 'STAND-ALU-08', 179.00, 'PLN', '[]'::jsonb),
  ('ol_product_seed09', 'Portable SSD 1TB USB-C', 'SSD-1TB-09', 379.00, 'PLN', '[]'::jsonb),
  ('ol_product_seed10', 'Discontinued Retro Trackball', 'TRK-RETRO-10', 89.00, 'PLN', '[]'::jsonb)
;

INSERT INTO product_variants (id, "productId", sku, ean, attributes, "isStale") VALUES
  ('ol_variant_seed01', 'ol_product_seed01', 'KBD-RGB-01', '5901234567891', '{"color":"Black"}'::jsonb, false),
  ('ol_variant_seed02', 'ol_product_seed02', 'MOU-ERG-02', '5901234567892', '{}'::jsonb, false),
  ('ol_variant_seed03', 'ol_product_seed03', 'DOC-USBC-03', '5901234567893', '{}'::jsonb, false),
  ('ol_variant_seed04', 'ol_product_seed04', 'HP-NC-04', '5901234567894', '{"color":"White"}'::jsonb, false),
  ('ol_variant_seed05', 'ol_product_seed05', 'MON-4K-05', '5901234567895', '{}'::jsonb, false),
  ('ol_variant_seed06', 'ol_product_seed06', 'NUM-COMP-06', '5901234567896', '{}'::jsonb, false),
  ('ol_variant_seed07', 'ol_product_seed07', 'CAM-1080-07', '5901234567897', '{}'::jsonb, false),
  ('ol_variant_seed08', 'ol_product_seed08', 'STAND-ALU-08', '5901234567898', '{}'::jsonb, false),
  ('ol_variant_seed09', 'ol_product_seed09', 'SSD-1TB-09', '5901234567899', '{}'::jsonb, false),
  -- deleted-at-master variant, still selling on channel -> overselling escalation
  ('ol_variant_seed10', 'ol_product_seed10', 'TRK-RETRO-10', '5901234567900', '{}'::jsonb, true),
  -- second stale variant with NO channel reading at all -> "unknown" signal branch
  ('ol_variant_seed11', 'ol_product_seed10', 'TRK-RETRO-10-B', '5901234567901', '{"color":"Blue"}'::jsonb, true)
;

-- Offer mappings (identifier_mappings, entityType='Offer')
-- Active (3): live on channel, has price+qty
INSERT INTO identifier_mappings ("entityType", "internalId", "externalId", "platformType", "connectionId") VALUES
  ('Offer', 'ol_variant_seed01', 'ALG-OFFER-0001', 'allegro', '11111111-1111-1111-1111-111111111111'),
  ('Offer', 'ol_variant_seed02', 'ALG-OFFER-0002', 'allegro', '11111111-1111-1111-1111-111111111111'),
  ('Offer', 'ol_variant_seed03', 'ERLI-OFFER-0003', 'erli', '22222222-2222-2222-2222-222222222222'),
  -- Inactive (2): validator-rejected
  ('Offer', 'ol_variant_seed04', 'ALG-OFFER-0004', 'allegro', '11111111-1111-1111-1111-111111111111'),
  ('Offer', 'ol_variant_seed05', 'ALG-OFFER-0005', 'allegro', '11111111-1111-1111-1111-111111111111'),
  -- Draft (2): not live, no validator messages
  ('Offer', 'ol_variant_seed06', 'ERLI-OFFER-0006', 'erli', '22222222-2222-2222-2222-222222222222'),
  ('Offer', 'ol_variant_seed07', 'ALG-OFFER-0007', 'allegro', '11111111-1111-1111-1111-111111111111'),
  -- Ended (1)
  ('Offer', 'ol_variant_seed08', 'ALG-OFFER-0008', 'allegro', '11111111-1111-1111-1111-111111111111'),
  -- Unsynced (1): mapping exists, no snapshot ever
  ('Offer', 'ol_variant_seed09', 'ERLI-OFFER-0009', 'erli', '22222222-2222-2222-2222-222222222222'),
  -- Stale + still selling (overselling escalation), Active status
  ('Offer', 'ol_variant_seed10', 'ALG-OFFER-0010', 'allegro', '11111111-1111-1111-1111-111111111111'),
  -- Stale + Unsynced (unknown channel signal)
  ('Offer', 'ol_variant_seed11', 'ALG-OFFER-0011', 'allegro', '11111111-1111-1111-1111-111111111111')
;

-- Status snapshots (offer_status_snapshots) — omitted for seed09 and seed11 (Unsynced)
INSERT INTO offer_status_snapshots ("connectionId", "externalOfferId", "internalVariantId", "publicationStatus", "statusDetails", "lastStatusSyncedAt") VALUES
  ('11111111-1111-1111-1111-111111111111', 'ALG-OFFER-0001', 'ol_variant_seed01', 'active', '{}'::jsonb, now() - interval '35 minutes'),
  ('11111111-1111-1111-1111-111111111111', 'ALG-OFFER-0002', 'ol_variant_seed02', 'active', '{}'::jsonb, now() - interval '2 hours'),
  ('22222222-2222-2222-2222-222222222222', 'ERLI-OFFER-0003', 'ol_variant_seed03', 'active', '{}'::jsonb, now() - interval '10 minutes'),
  ('11111111-1111-1111-1111-111111111111', 'ALG-OFFER-0004', 'ol_variant_seed04', 'inactive', '{"validationMessages":["Category parameter \"Brand\" is required.","Image resolution too low (min 500x500)."]}'::jsonb, now() - interval '1 day'),
  ('11111111-1111-1111-1111-111111111111', 'ALG-OFFER-0005', 'ol_variant_seed05', 'inactive', '{"validationMessages":["Price must be greater than 0."]}'::jsonb, now() - interval '3 hours'),
  ('22222222-2222-2222-2222-222222222222', 'ERLI-OFFER-0006', 'ol_variant_seed06', 'inactive', '{}'::jsonb, now() - interval '6 hours'),
  ('11111111-1111-1111-1111-111111111111', 'ALG-OFFER-0007', 'ol_variant_seed07', 'inactive', '{}'::jsonb, now() - interval '2 days'),
  ('11111111-1111-1111-1111-111111111111', 'ALG-OFFER-0008', 'ol_variant_seed08', 'ended', '{}'::jsonb, now() - interval '9 days'),
  ('11111111-1111-1111-1111-111111111111', 'ALG-OFFER-0010', 'ol_variant_seed10', 'active', '{}'::jsonb, now() - interval '40 hours')
;

-- Commercial snapshots (price/qty) — omitted where price/qty deliberately absent
INSERT INTO offer_commercial_snapshots ("connectionId", "externalOfferId", "internalVariantId", price, currency, "availableQuantity", "lastCommercialSyncedAt") VALUES
  ('11111111-1111-1111-1111-111111111111', 'ALG-OFFER-0001', 'ol_variant_seed01', 349.00, 'PLN', 42, now() - interval '35 minutes'),
  -- null price, has quantity (sparse read)
  ('11111111-1111-1111-1111-111111111111', 'ALG-OFFER-0002', 'ol_variant_seed02', NULL, NULL, 17, now() - interval '2 hours'),
  ('22222222-2222-2222-2222-222222222222', 'ERLI-OFFER-0003', 'ol_variant_seed03', 459.00, 'PLN', 0, now() - interval '10 minutes'),
  ('11111111-1111-1111-1111-111111111111', 'ALG-OFFER-0004', 'ol_variant_seed04', 899.00, 'PLN', 5, now() - interval '1 day'),
  -- has price, null quantity
  ('11111111-1111-1111-1111-111111111111', 'ALG-OFFER-0005', 'ol_variant_seed05', 1699.00, 'PLN', NULL, now() - interval '3 hours'),
  ('11111111-1111-1111-1111-111111111111', 'ALG-OFFER-0008', 'ol_variant_seed08', 89.00, 'PLN', 0, now() - interval '9 days'),
  -- overselling: stale variant still has stock on channel
  ('11111111-1111-1111-1111-111111111111', 'ALG-OFFER-0010', 'ol_variant_seed10', 89.00, 'PLN', 8, now() - interval '40 hours')
;

COMMIT;
