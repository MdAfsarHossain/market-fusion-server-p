import express from "express";
import { AuthRouters } from "../modules/auth/auth.routes";
import { UserRoute } from "../modules/user/user.route";
import { WebhookRoute } from "../modules/webhooks/webhook.route";
import { AdminRoutes } from "../modules/admin/admin.route";
import { StoreRoutes } from "../modules/store/store.route";
import { CategoryRoutes } from "../modules/category/category.route";
import { ProductRoutes } from "../modules/product/product.route";
import { CartRoutes } from "../modules/cart/cart.route";
import { AddressRoutes } from "../modules/address/address.route";
import { OrderRoutes } from "../modules/order/order.route";
import { PaymentRoutes } from "../modules/payment/payment.route";
import { WalletRoutes } from "../modules/wallet/wallet.route";
import { CouponRoutes } from "../modules/coupon/coupon.route";
import { ReviewRoutes } from "../modules/review/review.route";
import { InventoryRoutes } from "../modules/inventory/inventory.route";
import { NotificationRoutes } from "../modules/notification/notification.route";
import { StaffRoutes } from "../modules/staff/staff.route";
import { RentalRoutes } from "../modules/rental/rental.route";
import { ServiceRoutes } from "../modules/service/service.route";
import { ChatRoutes } from "../modules/chat/chat.route";
import { AnalyticsRoutes } from "../modules/analytics/analytics.route";
import { DemoRoutes } from "../modules/demo/demo.route";
import { HealthRoutes } from "../modules/health/health.route";

const router = express.Router();

const moduleRoutes = [
  {
    path: "/auth",
    route: AuthRouters,
  },
  {
    path: "/user",
    route: UserRoute,
  },
  {
    path: "/webhooks",
    route: WebhookRoute,
  },
  {
    path: "/admin",
    route: AdminRoutes,
  },
  {
    path: "/store",
    route: StoreRoutes,
  },
  {
    path: "/category",
    route: CategoryRoutes,
  },
  {
    path: "/product",
    route: ProductRoutes,
  },
  {
    path: "/cart",
    route: CartRoutes,
  },
  {
    path: "/address",
    route: AddressRoutes,
  },
  {
    path: "/order",
    route: OrderRoutes,
  },
  {
    path: "/payment",
    route: PaymentRoutes,
  },
  {
    path: "/wallet",
    route: WalletRoutes,
  },
  {
    path: "/coupon",
    route: CouponRoutes,
  },
  {
    path: "/review",
    route: ReviewRoutes,
  },
  {
    path: "/inventory",
    route: InventoryRoutes,
  },
  {
    path: "/notification",
    route: NotificationRoutes,
  },
  {
    path: "/staff",
    route: StaffRoutes,
  },
  {
    path: "/rental",
    route: RentalRoutes,
  },
  {
    path: "/service",
    route: ServiceRoutes,
  },
  {
    path: "/chat",
    route: ChatRoutes,
  },
  {
    path: "/analytics",
    route: AnalyticsRoutes,
  },
  {
    path: "/demo",
    route: DemoRoutes,
  },
  {
    path: "/health",
    route: HealthRoutes,
  },
];

moduleRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
