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

  // Staff accounts (site-native accounts stored in the database) may open
  // exactly the pages the manager granted them (their `pages` list, default
  // inventory count only); every other target is redirected to their first
  // granted page. This guard is where staff page permissions are enforced.
  const staffSession = staffAuthService.getSession();
  if (staffSession) {
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
