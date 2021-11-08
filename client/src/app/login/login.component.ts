import { Component } from "@angular/core";
import { AuthenticationService, TokenPayload } from "../services/authentication.service";
import { Router } from "@angular/router";

@Component({
  templateUrl: "./login.component.html",
  styleUrls: ["./login.component.css"]
})
export class LoginComponent {
  credentials: TokenPayload = {
    email: "",
    password: ""
  };
  errMessage: string;

  constructor(private auth: AuthenticationService, private router: Router) {}

  login() {
    this.errMessage = null;
    this.auth.login(this.credentials).subscribe(
      () => {
        this.router.navigateByUrl("/");
      },
      (err) => {
        this.errMessage = err.error.message;
      }
    );
  }
}
