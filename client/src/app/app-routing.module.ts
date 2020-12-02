import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import {HomeComponent} from "./home/home.component";
import {LoginComponent} from "./login/login.component";
import {SettingsComponent} from "./settings/settings.component";
import {RegisterComponent} from "./register/register.component";
import {AuthGuard} from "./auth.guard";
import {NonAuthGuard} from "./nonAuth.guard";

const routes: Routes = [
  { path: "", component: HomeComponent },
  { path: "login", component: LoginComponent, canActivate: [NonAuthGuard] },
  { path: "register", component: RegisterComponent, canActivate: [NonAuthGuard] },
  { path: "settings", component: SettingsComponent, canActivate: [AuthGuard] }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
