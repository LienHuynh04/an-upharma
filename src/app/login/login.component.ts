import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { UpharmaService } from "../upharma.service";

type LoginFocus = "username" | "password" | "";

@Component({
  selector: "app-login",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./login.component.html",
})
export class LoginComponent implements OnInit {
  username = "";
  password = "";
  focusedField: LoginFocus = "";
  pointerX = 0;
  pointerY = 0;
  loading = false;
  loadingProgress = 0;
  errorText = "";

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly upharmaService: UpharmaService,
  ) {}

  ngOnInit(): void {
    if (this.upharmaService.isAuthenticated()) {
      void this.router.navigateByUrl("/profile");
    }
  }

  get faceClasses(): Record<string, boolean> {
    return {
      "is-looking": this.focusedField === "username" && this.username.length > 0,
      "is-covering": this.focusedField === "password",
      "is-happy": this.focusedField === "username" && this.username.length > 2,
      "has-error": Boolean(this.errorText),
    };
  }

  get eyeTransform(): string {
    if (this.focusedField === "password") {
      return "translate(0, 0) scaleY(0.35)";
    }

    if (this.focusedField === "username") {
      const xOffset = Math.min(9, Math.max(-5, this.username.length * 0.55 - 2));
      const yOffset = Math.min(4, this.username.length * 0.15);

      return `translate(${xOffset}px, ${yOffset}px)`;
    }

    return `translate(${this.pointerX * 7}px, ${this.pointerY * 4}px)`;
  }

  get headTransform(): string {
    if (this.focusedField === "password") {
      return "";
    }

    return `rotate(${this.pointerX * 4}deg) translate(${this.pointerX * 3}px, ${this.pointerY * 4}px)`;
  }

  trackPointer(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    this.pointerX = this.clamp((event.clientX - centerX) / (rect.width / 2), -1, 1);
    this.pointerY = this.clamp((event.clientY - centerY) / (rect.height / 2), -1, 1);
  }

  resetPointer(): void {
    this.pointerX = 0;
    this.pointerY = 0;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  async submitLogin(): Promise<void> {
    this.loading = true;
    this.loadingProgress = 15;
    this.errorText = "";

    try {
      this.loadingProgress = 45;
      await this.upharmaService.login({
        UserName: this.username.trim(),
        Password: this.password,
      });
      this.loadingProgress = 85;
      this.upharmaService.prefetchSalesSpeed();

      const returnUrl = this.route.snapshot.queryParamMap.get("returnUrl") || "/profile";
      this.loadingProgress = 100;
      await this.router.navigateByUrl(returnUrl);
    } catch (error) {
      this.errorText = error instanceof Error ? error.message : String(error);
      this.loadingProgress = 100;
    } finally {
      this.loading = false;
    }
  }
}
