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

  // Staff accounts sign in through Firebase Auth only. A counter account may
  // open exactly the pages the manager granted it (its `pages` list, default
  // inventory count only); every other target is redirected to its first
  // granted page. The shared management (admin) session on its own may open
  // the account-management and inventory-count pages.
  const staffSession = staffAuthService.getSession();
  if (staffSession) {
    if (staffSession.role === "admin") {
      return state.url.startsWith("/tai-khoan-kiem-ke") || state.url.startsWith("/kiem-ke")
        ? true
        : router.createUrlTree(["/tai-khoan-kiem-ke"]);
    }
    const pages = staffSession.pages?.length ? staffSession.pages : ["kiem-ke"];
    const allowed = pages.some((page) => state.url.startsWith(`/${page}`));
    if (allowed) return true;
    const home = pages.includes("kiem-ke") ? "kiem-ke" : pages[0];
    return router.createUrlTree([`/${home}`]);
  }

  return router.createUrlTree(["/login"], {
    queryParams: {
      returnUrl: state.url,
    },
  });
};
