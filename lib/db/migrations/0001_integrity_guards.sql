-- Append-only audit log: reject UPDATE and DELETE.
CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
--> statement-breakpoint
-- At most one active pricing rule version.
CREATE UNIQUE INDEX pricing_rule_versions_one_active ON pricing_rule_versions (status) WHERE status = 'active';
--> statement-breakpoint
-- Money columns are never negative.
ALTER TABLE orders ADD CONSTRAINT orders_amounts_nonneg CHECK (subtotal_minor >= 0 AND tax_minor >= 0 AND total_minor >= 0 AND deposit_minor >= 0 AND deposit_minor <= total_minor);
--> statement-breakpoint
ALTER TABLE invoices ADD CONSTRAINT invoices_amounts_nonneg CHECK (total_minor >= 0 AND amount_paid_minor >= 0 AND amount_refunded_minor >= 0 AND amount_refunded_minor <= amount_paid_minor);
--> statement-breakpoint
ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_amount_pos CHECK (amount_minor > 0);
--> statement-breakpoint
ALTER TABLE payment_transactions ADD CONSTRAINT payment_tx_amount_pos CHECK (amount_minor > 0 AND refunded_minor >= 0 AND refunded_minor <= amount_minor);
--> statement-breakpoint
ALTER TABLE refunds ADD CONSTRAINT refunds_amount_pos CHECK (amount_minor > 0);
--> statement-breakpoint
ALTER TABLE packages ADD CONSTRAINT packages_price_nonneg CHECK (price_minor >= 0);
--> statement-breakpoint
-- Financial history is never hard-deleted.
CREATE OR REPLACE FUNCTION financial_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be deleted; void or archive instead', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoices_no_delete BEFORE DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION financial_no_delete();
--> statement-breakpoint
CREATE TRIGGER payment_transactions_no_delete BEFORE DELETE ON payment_transactions FOR EACH ROW EXECUTE FUNCTION financial_no_delete();
--> statement-breakpoint
CREATE TRIGGER refunds_no_delete BEFORE DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION financial_no_delete();
--> statement-breakpoint
CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders FOR EACH ROW EXECUTE FUNCTION financial_no_delete();
