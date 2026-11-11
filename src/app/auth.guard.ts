import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { StaffAuthService } from "./staff-auth.service";
import { UpharmaService } from "./upharma.service";

export const authGuard: CanActivateFn = (_route, state) => {
  const upharmaService = inject(UpharmaService);
  const staffAuthService = inject(StaffAuthService);
  const router = inject(Router);

  if (upharmaService.isAuthenticated()) {
    return true;
  }

  // Staff (inventory counter) accounts sign in through Firebase Auth only.
  // They may open the inventory-count page and nothing else; every other
  // target is redirected there.
  if (staffAuthService.hasSession()) {
    return state.url.startsWith("/kiem-ke")
      ? true
      : router.createUrlTree(["/kiem-ke"]);
  }

  return router.createUrlTree(["/login"], {
    queryParams: {
      returnUrl: state.url,
    },
  });
};
