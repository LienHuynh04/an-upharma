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

const routes: Routes = [
  {
    path: "",
    redirectTo: "profile",
    pathMatch: "full",
  },
  {
    path: "login",
    component: LoginComponent,
  },
  {
    path: "ton-kho",
    component: InventoryComponent,
    canActivate: [authGuard],
  },
  {
    path: "dashboard",
    redirectTo: "ton-kho",
    pathMatch: "full",
  },
  {
    path: "profile",
    component: ProfileComponent,
    canActivate: [authGuard],
  },
  {
    path: "api-test",
    component: ApiTestComponent,
    canActivate: [authGuard],
  },
  {
    path: "out-of-stock",
    component: OutOfStockComponent,
    canActivate: [authGuard],
  },
  {
    path: "hang-lap-tot",
    component: StableConsumptionComponent,
    canActivate: [authGuard],
  },
  {
    path: "hang-da-het",
    component: OutOfStockComponent,
    canActivate: [authGuard],
  },
  {
    path: "hang-ban-cham",
    component: SlowSellingComponent,
    canActivate: [authGuard],
  },
  {
    path: "cronjob",
    loadComponent: () => import("./app/cronjob/cronjob.component").then(m => m.CronjobComponent),
    canActivate: [authGuard],
  },
  {
    path: "**",
    redirectTo: "profile",
  },
];

bootstrapApplication(RootComponent, {
  providers: [provideRouter(routes, withHashLocation())],
}).catch((error) => console.error(error));
