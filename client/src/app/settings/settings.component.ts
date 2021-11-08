import { Component, OnInit } from "@angular/core";
import { AuthenticationService, UserDetails } from "../services/authentication.service";

@Component({
  templateUrl: "./settings.component.html",
  styleUrls: ["./settings.component.css"]
})
export class SettingsComponent implements OnInit {
  details: UserDetails;

  constructor(private auth: AuthenticationService) {}

  ngOnInit() {
    // Verify token with database
    this.auth.settings().subscribe(
      user => {
        this.details = user;
      },
      err => {
        console.error(err);
      }
    );
  }
}
