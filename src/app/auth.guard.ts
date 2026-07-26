import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { UpharmaService } from "./upharma.service";

export const authGuard: CanActivateFn = (_route, state) => {
  const upharmaService = inject(UpharmaService);
  const router = inject(Router);

  if (upharmaService.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(["/login"], {
    queryParams: {
      returnUrl: state.url,
    },
  });
};
