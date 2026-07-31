import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter, Routes, withHashLocation } from "@angular/router";
import { ApiTestComponent } from "./app/api-test/api-test.component";
import { authGuard } from "./app/auth.guard";
import { InventoryComponent } from "./app/inventory/inventory.component";
import { LoginComponent } from "./app/login/login.component";
import { OutOfStockComponent } from "./app/out-of-stock/out-of-stock.component";
import { ProfileComponent } from "./app/profile/profile.component";
import { RootComponent } from "./app/root.component";
import { SlowSellingComponent } from "./app/slow-selling/slow-selling.component";
import { StableConsumptionComponent } from "./app/stable-consumption/stable-consumption.component";
import { LayoutComponent } from "./app/layout/layout.component";

const routes: Routes = [
  {
    path: "",
    redirectTo: "ton-kho",
    pathMatch: "full",
  },
  {
    path: "login",
    component: LoginComponent,
  },
  {
    path: "",
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: "ton-kho",
        component: InventoryComponent,
      },
      {
        path: "dashboard",
        redirectTo: "ton-kho",
        pathMatch: "full",
      },
      {
        path: "profile",
        component: ProfileComponent,
      },
      {
        path: "api-test",
        component: ApiTestComponent,
      },
      {
        path: "out-of-stock",
        component: OutOfStockComponent,
      },
      {
        path: "hang-lap-tot",
        component: StableConsumptionComponent,
      },
      {
        path: "hang-da-het",
        component: OutOfStockComponent,
      },
      {
        path: "hang-ban-cham",
        component: SlowSellingComponent,
      },
      {
        path: "cronjob",
        loadComponent: () => import("./app/cronjob/cronjob.component").then((m) => m.CronjobComponent),
      },
    ],
  },
  {
    path: "**",
    redirectTo: "ton-kho",
  },
];

bootstrapApplication(RootComponent, {
  providers: [provideRouter(routes, withHashLocation())],
}).catch((error) => console.error(error));
