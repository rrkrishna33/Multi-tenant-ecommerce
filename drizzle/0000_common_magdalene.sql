CREATE TYPE "public"."order_status" AS ENUM('pending', 'paid', 'packed', 'dispatched', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('trial', 'active', 'past_due', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('platform_admin', 'shop_owner', 'shop_staff');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_ta" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"product_name" text NOT NULL,
	"unit" text NOT NULL,
	"mrp" integer NOT NULL,
	"discount_pct" integer NOT NULL,
	"unit_price" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_number" integer NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_email" text,
	"address_line" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"pincode" text NOT NULL,
	"notes" text,
	"subtotal" integer NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"transport_name" text,
	"transport_lr_number" text,
	"payment_ref" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid,
	"name" text NOT NULL,
	"name_ta" text,
	"sku" text,
	"description" text,
	"mrp" integer NOT NULL,
	"discount_pct" integer DEFAULT 0 NOT NULL,
	"unit" text DEFAULT 'box' NOT NULL,
	"pieces_per_unit" integer,
	"image_url" text,
	"youtube_url" text,
	"stock" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan" text NOT NULL,
	"amount" integer NOT NULL,
	"period_months" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"shop_name" text NOT NULL,
	"custom_domain" text,
	"status" "tenant_status" DEFAULT 'trial' NOT NULL,
	"phone" text,
	"whatsapp" text,
	"email" text,
	"address_line" text,
	"city" text DEFAULT 'Sivakasi',
	"state" text DEFAULT 'Tamil Nadu',
	"pincode" text,
	"gstin" text,
	"license_number" text,
	"upi_id" text,
	"bank_account_name" text,
	"bank_account_number" text,
	"bank_ifsc" text,
	"min_order_value" integer DEFAULT 250000 NOT NULL,
	"theme_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'shop_staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_tenant_idx" ON "categories" USING btree ("tenant_id","sort_order");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_tenant_number_key" ON "orders" USING btree ("tenant_id","order_number");--> statement-breakpoint
CREATE INDEX "orders_tenant_created_idx" ON "orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "products_tenant_idx" ON "products" USING btree ("tenant_id","sort_order");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_sku_key" ON "products" USING btree ("tenant_id","sku");--> statement-breakpoint
CREATE INDEX "subscriptions_tenant_idx" ON "subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_custom_domain_key" ON "tenants" USING btree ("custom_domain");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_tenant_idx" ON "users" USING btree ("tenant_id");