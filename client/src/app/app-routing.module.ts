import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import {HomeComponent} from "./home/home.component";
import {LoginComponent} from "./login/login.component";
import {SettingsComponent} from "./settings/settings.component";
import {RegisterComponent} from "./register/register.component";
import {PageNotFoundComponent} from './page-not-found/page-not-found.component';
import {AuthGuard} from "./auth.guard";
import {NonAuthGuard} from "./nonAuth.guard";
import {RadgroupComponent} from './home/radgroup/radgroup.component';
import {LeaveRoomGuard} from './leaveRoom.guard';

const routes: Routes = [
  { path: "", component: HomeComponent },
  { path: "login", component: LoginComponent, canActivate: [NonAuthGuard] },
  { path: "register", component: RegisterComponent, canActivate: [NonAuthGuard] },
  { path: "settings", component: SettingsComponent, canActivate: [AuthGuard] },
  { path: "room", component: RadgroupComponent, canActivate: [AuthGuard], canDeactivate: [LeaveRoomGuard] },
  { path: "**", component: PageNotFoundComponent },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { relativeLinkResolution: 'legacy' })],
  exports: [RouterModule]
})
export class AppRoutingModule { }
